//! Project a `DescriptorPool` into a stable `ServiceCatalog`.

use crate::grpc::catalog::{MethodEntry, ServiceCatalog, ServiceEntry};
use prost_reflect::DescriptorPool;

/// Snapshot all services in `pool` into a `ServiceCatalog`. Services are sorted by
/// full_name for stable UI rendering.
pub fn build_catalog(pool: &DescriptorPool) -> ServiceCatalog {
    let mut services: Vec<ServiceEntry> = pool
        .services()
        .map(|s| {
            let mut methods: Vec<MethodEntry> = s
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
            methods.sort_by(|a, b| a.name.cmp(&b.name));
            ServiceEntry {
                full_name: s.full_name().to_string(),
                methods,
            }
        })
        .collect();
    services.sort_by(|a, b| a.full_name.cmp(&b.full_name));
    ServiceCatalog { services }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::grpc::descriptor::build_pool;
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
                            name: Some("Bar".into()),
                            input_type: Some(".test.Empty".into()),
                            output_type: Some(".test.Empty".into()),
                            client_streaming: Some(true),
                            server_streaming: Some(false),
                            ..Default::default()
                        },
                        MethodDescriptorProto {
                            name: Some("Foo".into()),
                            input_type: Some(".test.Empty".into()),
                            output_type: Some(".test.Empty".into()),
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
    fn catalog_is_sorted_and_method_paths_correct() {
        let pool = build_pool(vec![simple_file_with_two_services()]).unwrap();
        let cat = build_catalog(&pool);
        assert_eq!(cat.services.len(), 2);
        assert_eq!(cat.services[0].full_name, "test.Alpha");
        assert_eq!(cat.services[1].full_name, "test.Beta");

        let alpha = &cat.services[0];
        assert_eq!(alpha.methods.len(), 2);
        assert_eq!(alpha.methods[0].name, "Bar");
        assert_eq!(alpha.methods[0].path, "/test.Alpha/Bar");
        assert!(alpha.methods[0].client_streaming);
        assert!(!alpha.methods[0].server_streaming);
        assert_eq!(alpha.methods[1].name, "Foo");
        assert_eq!(alpha.methods[1].path, "/test.Alpha/Foo");
        assert_eq!(alpha.methods[1].input_message, "test.Empty");
        assert_eq!(alpha.methods[1].output_message, "test.Empty");
    }
}
