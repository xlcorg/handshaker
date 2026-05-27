//! Auto-skeleton: builds a serde-JSON object with every field set to its proto3 default.
//! Used by the UI when the user clicks a method in the catalog — pre-populates the request
//! editor with the message shape.

use prost_reflect::{Kind, MessageDescriptor};
use serde_json::{json, Map, Value};
use std::collections::HashSet;

/// Maximum nesting depth when expanding nested messages. Defense against stack overflow
/// on recursive types (`Node { Node child }`).
#[allow(dead_code)]
pub(crate) const MAX_DEPTH: usize = 4;

/// Build a JSON skeleton for a message with default values.
///
/// Conventions:
/// - scalars → `0` / `false` / `""` / `0.0`
/// - bytes → `""` (base64-empty)
/// - enum → name of the default variant (proto3 — usually tag 0)
/// - repeated → `[]`
/// - map → `{}`
/// - message → recursive expansion
/// - depth ≥ MAX_DEPTH or message already being expanded → `"..."` placeholder.
#[allow(dead_code)]
pub(crate) fn build_default_json_skeleton(desc: &MessageDescriptor) -> Value {
    build_message(desc, 0, &mut HashSet::new())
}

#[allow(dead_code)]
fn build_message(desc: &MessageDescriptor, depth: usize, visiting: &mut HashSet<String>) -> Value {
    let name = desc.full_name().to_string();
    if depth >= MAX_DEPTH || !visiting.insert(name.clone()) {
        return json!("...");
    }
    let mut obj = Map::new();
    for field in desc.fields() {
        let value = if field.is_list() {
            json!([])
        } else if field.is_map() {
            json!({})
        } else {
            default_for_kind(&field.kind(), depth, visiting)
        };
        obj.insert(field.json_name().to_string(), value);
    }
    visiting.remove(&name);
    Value::Object(obj)
}

#[allow(dead_code)]
fn default_for_kind(kind: &Kind, depth: usize, visiting: &mut HashSet<String>) -> Value {
    use Kind::*;
    match kind {
        Double | Float => json!(0.0),
        Int32 | Sint32 | Sfixed32 | Int64 | Sint64 | Sfixed64
        | Uint32 | Fixed32 | Uint64 | Fixed64 => json!(0),
        Bool => json!(false),
        String => json!(""),
        Bytes => json!(""),
        Enum(e) => json!(e.default_value().name()),
        Message(m) => build_message(m, depth + 1, visiting),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use prost::Message as _;
    use prost_reflect::DescriptorPool;
    use prost_types::{field_descriptor_proto::Type as Ty, *};

    fn pool_with(set: FileDescriptorSet) -> DescriptorPool {
        let mut pool = DescriptorPool::new();
        let mut buf = Vec::new();
        set.encode(&mut buf).expect("encode");
        let decoded = FileDescriptorSet::decode(&buf[..]).expect("roundtrip");
        pool.add_file_descriptor_set(decoded).expect("add");
        pool
    }

    fn scalar_message_pool() -> DescriptorPool {
        let m = DescriptorProto {
            name: Some("M".into()),
            field: vec![
                FieldDescriptorProto {
                    name: Some("s".into()),
                    number: Some(1),
                    r#type: Some(Ty::String as i32),
                    ..Default::default()
                },
                FieldDescriptorProto {
                    name: Some("i".into()),
                    number: Some(2),
                    r#type: Some(Ty::Int32 as i32),
                    ..Default::default()
                },
                FieldDescriptorProto {
                    name: Some("b".into()),
                    number: Some(3),
                    r#type: Some(Ty::Bool as i32),
                    ..Default::default()
                },
                FieldDescriptorProto {
                    name: Some("d".into()),
                    number: Some(4),
                    r#type: Some(Ty::Double as i32),
                    ..Default::default()
                },
            ],
            ..Default::default()
        };
        pool_with(FileDescriptorSet {
            file: vec![FileDescriptorProto {
                name: Some("t.proto".into()),
                package: Some("t".into()),
                syntax: Some("proto3".into()),
                message_type: vec![m],
                ..Default::default()
            }],
        })
    }

    #[test]
    fn scalars_get_proto3_defaults() {
        let pool = scalar_message_pool();
        let desc = pool.get_message_by_name("t.M").unwrap();
        let v = build_default_json_skeleton(&desc);
        assert_eq!(v["s"], json!(""));
        assert_eq!(v["i"], json!(0));
        assert_eq!(v["b"], json!(false));
        assert_eq!(v["d"], json!(0.0));
    }

    #[test]
    fn repeated_becomes_empty_array() {
        let m = DescriptorProto {
            name: Some("Repeated".into()),
            field: vec![FieldDescriptorProto {
                name: Some("items".into()),
                number: Some(1),
                r#type: Some(Ty::String as i32),
                label: Some(field_descriptor_proto::Label::Repeated as i32),
                ..Default::default()
            }],
            ..Default::default()
        };
        let pool = pool_with(FileDescriptorSet {
            file: vec![FileDescriptorProto {
                name: Some("r.proto".into()),
                package: Some("r".into()),
                syntax: Some("proto3".into()),
                message_type: vec![m],
                ..Default::default()
            }],
        });
        let desc = pool.get_message_by_name("r.Repeated").unwrap();
        let v = build_default_json_skeleton(&desc);
        assert_eq!(v["items"], json!([]));
    }

    #[test]
    fn recursive_self_referencing_message_caps_at_max_depth() {
        // message Node { Node child = 1; string label = 2; }
        let node = DescriptorProto {
            name: Some("Node".into()),
            field: vec![
                FieldDescriptorProto {
                    name: Some("child".into()),
                    number: Some(1),
                    r#type: Some(Ty::Message as i32),
                    type_name: Some(".r.Node".into()),
                    ..Default::default()
                },
                FieldDescriptorProto {
                    name: Some("label".into()),
                    number: Some(2),
                    r#type: Some(Ty::String as i32),
                    ..Default::default()
                },
            ],
            ..Default::default()
        };
        let pool = pool_with(FileDescriptorSet {
            file: vec![FileDescriptorProto {
                name: Some("r.proto".into()),
                package: Some("r".into()),
                syntax: Some("proto3".into()),
                message_type: vec![node],
                ..Default::default()
            }],
        });
        let desc = pool.get_message_by_name("r.Node").unwrap();
        let v = build_default_json_skeleton(&desc);
        // At depth=0 — full message. At depth=1 — visiting already contains "r.Node",
        // so child becomes "...".
        assert_eq!(v["label"], json!(""));
        assert_eq!(v["child"], json!("..."));
    }
}
