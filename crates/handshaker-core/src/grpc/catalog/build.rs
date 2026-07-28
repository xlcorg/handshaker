//! Project a `PoolSet` into a stable `ServiceCatalog`.

use crate::grpc::catalog::{MethodEntry, ServiceCatalog, ServiceEntry};
use crate::grpc::descriptor::PoolSet;

/// Snapshot every service across every pool in `pools` into a `ServiceCatalog`. Services
/// are sorted by full_name for a stable list; methods keep their `.proto` definition
/// order. A service declared in more than one pool is listed once.
///
/// The dedup keeps the FIRST of the sorted-equal entries, and `sort_by` is stable — so
/// the surviving entry is the one from the earliest pool, matching the first-wins
/// `PoolSet::for_service` index. The catalog and the invoke path therefore agree on
/// which copy of a duplicated service name is the real one.
pub fn build_catalog(pools: &PoolSet) -> ServiceCatalog {
    let mut services: Vec<ServiceEntry> = pools
        .pools()
        .flat_map(|pool| pool.services())
        .map(|s| {
            let methods: Vec<MethodEntry> = s
                .methods()
                .map(|m| MethodEntry {
                    name: m.name().to_string(),
                    path: format!("/{}/{}", s.full_name(), m.name()),
                    input_message: m.input().full_name().to_string(),
                    output_message: m.output().full_name().to_string(),
                    client_streaming: m.is_client_streaming(),
                    server_streaming: m.is_server_streaming(),
                })
                .collect();
            ServiceEntry {
                full_name: s.full_name().to_string(),
                methods,
            }
        })
        .collect();
    services.sort_by(|a, b| a.full_name.cmp(&b.full_name));
    services.dedup_by(|a, b| a.full_name == b.full_name);
    ServiceCatalog { services }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::grpc::descriptor::{build_pool, build_pool_set, PoolSet};
    use prost_types::{
        field_descriptor_proto::Type as FieldType, DescriptorProto, FieldDescriptorProto,
        FileDescriptorProto, MethodDescriptorProto, ServiceDescriptorProto,
    };

    fn simple_file_with_two_services() -> FileDescriptorProto {
        FileDescriptorProto {
            name: Some("test/multi.proto".into()),
            package: Some("test".into()),
            syntax: Some("proto3".into()),
            message_type: vec![DescriptorProto {
                name: Some("Empty".into()),
                field: vec![FieldDescriptorProto {
                    name: Some("nothing".into()),
                    number: Some(1),
                    r#type: Some(FieldType::String as i32),
                    ..Default::default()
                }],
                ..Default::default()
            }],
            service: vec![
                ServiceDescriptorProto {
                    name: Some("Beta".into()),
                    method: vec![MethodDescriptorProto {
                        name: Some("Zeta".into()),
                        input_type: Some(".test.Empty".into()),
                        output_type: Some(".test.Empty".into()),
                        ..Default::default()
                    }],
                    ..Default::default()
                },
                ServiceDescriptorProto {
                    name: Some("Alpha".into()),
                    method: vec![
                        MethodDescriptorProto {
                            name: Some("Foo".into()),
                            input_type: Some(".test.Empty".into()),
                            output_type: Some(".test.Empty".into()),
                            ..Default::default()
                        },
                        MethodDescriptorProto {
                            name: Some("Bar".into()),
                            input_type: Some(".test.Empty".into()),
                            output_type: Some(".test.Empty".into()),
                            client_streaming: Some(true),
                            server_streaming: Some(false),
                            ..Default::default()
                        },
                    ],
                    ..Default::default()
                },
            ],
            ..Default::default()
        }
    }

    #[test]
    fn services_sorted_methods_in_definition_order() {
        let pool = build_pool(vec![simple_file_with_two_services()]).unwrap();
        let cat = build_catalog(&PoolSet::from_pool(pool));
        // Services stay alphabetically sorted (fixture defines Beta before Alpha).
        assert_eq!(cat.services.len(), 2);
        assert_eq!(cat.services[0].full_name, "test.Alpha");
        assert_eq!(cat.services[1].full_name, "test.Beta");

        // Methods keep `.proto` definition order (fixture defines Foo before Bar —
        // non-alphabetical, so this fails if the catalog re-sorts them).
        let alpha = &cat.services[0];
        assert_eq!(alpha.methods.len(), 2);
        assert_eq!(alpha.methods[0].name, "Foo");
        assert_eq!(alpha.methods[0].path, "/test.Alpha/Foo");
        assert_eq!(alpha.methods[0].input_message, "test.Empty");
        assert_eq!(alpha.methods[0].output_message, "test.Empty");
        assert_eq!(alpha.methods[1].name, "Bar");
        assert_eq!(alpha.methods[1].path, "/test.Alpha/Bar");
        assert!(alpha.methods[1].client_streaming);
        assert!(!alpha.methods[1].server_streaming);
    }

    /// `package test; message Empty {} service <svc> { rpc <method> (Empty) returns (Empty); }`
    ///
    /// Every file declares its own `test.Empty`, so any two of these are a duplicate-symbol
    /// corpus — which is exactly what makes `build_pool_set` leave the single-pool fast path
    /// and give each file its own pool.
    fn service_file(file: &str, svc: &str, method: &str) -> FileDescriptorProto {
        FileDescriptorProto {
            name: Some(file.into()),
            package: Some("test".into()),
            syntax: Some("proto3".into()),
            message_type: vec![DescriptorProto { name: Some("Empty".into()), ..Default::default() }],
            service: vec![ServiceDescriptorProto {
                name: Some(svc.into()),
                method: vec![MethodDescriptorProto {
                    name: Some(method.into()),
                    input_type: Some(".test.Empty".into()),
                    output_type: Some(".test.Empty".into()),
                    ..Default::default()
                }],
                ..Default::default()
            }],
            ..Default::default()
        }
    }

    #[test]
    fn catalog_merges_services_across_pools_sorted_and_deduped() {
        // File-name order (a, b) deliberately disagrees with service-name order (Zeta,
        // Alpha): pool order therefore cannot stand in for the catalog's own sort.
        let set = build_pool_set(&[
            service_file("a.proto", "Zeta", "Call"),
            service_file("b.proto", "Alpha", "Call"),
        ])
        .expect("isolation must rescue this corpus");
        assert_eq!(set.pool_count(), 2, "the duplicated test.Empty must force one pool each");

        let cat = build_catalog(&set);
        assert_eq!(cat.services.len(), 2, "every pool's services reach the catalog");
        assert_eq!(cat.services[0].full_name, "test.Alpha");
        assert_eq!(cat.services[1].full_name, "test.Zeta");
    }

    #[test]
    fn duplicated_service_is_listed_once_from_the_same_pool_for_service_picks() {
        // Two files declaring the SAME service full name, each landing in its own pool.
        let set = build_pool_set(&[
            service_file("first.proto", "Dup", "FromFirst"),
            service_file("second.proto", "Dup", "FromSecond"),
        ])
        .expect("isolation must rescue this corpus");
        assert_eq!(set.pool_count(), 2);

        let cat = build_catalog(&set);
        assert_eq!(cat.services.len(), 1, "a service in two pools is listed once");
        assert_eq!(cat.services[0].full_name, "test.Dup");
        // The catalog must show the SAME copy `PoolSet::for_service` hands the invoke path,
        // which is first-wins. Listing the second pool's methods would let the UI offer a
        // method that invoke cannot resolve.
        assert_eq!(cat.services[0].methods.len(), 1);
        assert_eq!(cat.services[0].methods[0].name, "FromFirst");
        assert_eq!(
            set.for_service("test.Dup")
                .unwrap()
                .get_service_by_name("test.Dup")
                .unwrap()
                .methods()
                .next()
                .unwrap()
                .name(),
            cat.services[0].methods[0].name,
            "catalog and for_service must agree on which copy wins"
        );
    }
}
