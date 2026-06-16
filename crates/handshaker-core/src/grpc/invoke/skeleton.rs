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
        Message(m) => match super::well_known::classify(m.full_name()) {
            // Scalar well-known types serialize as a bare proto3-JSON value,
            // not as a nested `{"value": …}` message.
            Some(wkt) => wkt.skeleton_default(),
            None => build_message(m, depth + 1, visiting),
        },
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

    fn msg(name: &str, fields: Vec<FieldDescriptorProto>) -> DescriptorProto {
        DescriptorProto {
            name: Some(name.into()),
            field: fields,
            ..Default::default()
        }
    }

    fn scalar_field(name: &str, number: i32, ty: Ty) -> FieldDescriptorProto {
        FieldDescriptorProto {
            name: Some(name.into()),
            number: Some(number),
            r#type: Some(ty as i32),
            ..Default::default()
        }
    }

    /// A hand-built `google.protobuf` file with the well-known types this fix
    /// touches, so a user field can reference e.g. `.google.protobuf.Int64Value`
    /// via `type_name`. Mirrors the upstream wire shape of each type.
    fn well_known_file() -> FileDescriptorProto {
        let wrapper = |name: &str, ty: Ty| msg(name, vec![scalar_field("value", 1, ty)]);
        FileDescriptorProto {
            name: Some("google/protobuf/wrappers.proto".into()),
            package: Some("google.protobuf".into()),
            syntax: Some("proto3".into()),
            message_type: vec![
                wrapper("DoubleValue", Ty::Double),
                wrapper("FloatValue", Ty::Float),
                wrapper("Int64Value", Ty::Int64),
                wrapper("UInt64Value", Ty::Uint64),
                wrapper("Int32Value", Ty::Int32),
                wrapper("UInt32Value", Ty::Uint32),
                wrapper("BoolValue", Ty::Bool),
                wrapper("StringValue", Ty::String),
                wrapper("BytesValue", Ty::Bytes),
                msg(
                    "Timestamp",
                    vec![
                        scalar_field("seconds", 1, Ty::Int64),
                        scalar_field("nanos", 2, Ty::Int32),
                    ],
                ),
                msg(
                    "Duration",
                    vec![
                        scalar_field("seconds", 1, Ty::Int64),
                        scalar_field("nanos", 2, Ty::Int32),
                    ],
                ),
                msg(
                    "FieldMask",
                    vec![FieldDescriptorProto {
                        name: Some("paths".into()),
                        number: Some(1),
                        r#type: Some(Ty::String as i32),
                        label: Some(field_descriptor_proto::Label::Repeated as i32),
                        ..Default::default()
                    }],
                ),
                // Two value-types that must NOT be schemed as scalars.
                msg("Empty", vec![]),
            ],
            ..Default::default()
        }
    }

    /// Pool with a `t.M { <wkt> v = 1; }` message whose single field references
    /// the given `google.protobuf.*` type by full name, plus the WKT file.
    fn wkt_field_pool(wkt_short: &str) -> DescriptorPool {
        let mut f = scalar_field("v", 1, Ty::Message);
        f.type_name = Some(format!(".google.protobuf.{wkt_short}"));
        let m = msg("M", vec![f]);
        pool_with(FileDescriptorSet {
            file: vec![
                well_known_file(),
                FileDescriptorProto {
                    name: Some("t.proto".into()),
                    package: Some("t".into()),
                    syntax: Some("proto3".into()),
                    dependency: vec!["google/protobuf/wrappers.proto".into()],
                    message_type: vec![m],
                    ..Default::default()
                },
            ],
        })
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

    /// Each scalar well-known type collapses to its bare proto3-JSON form
    /// instead of `{"value": …}` / `{"seconds": …}`.
    fn assert_wkt_skeleton(wkt_short: &str, expected: serde_json::Value) {
        let pool = wkt_field_pool(wkt_short);
        let desc = pool.get_message_by_name("t.M").unwrap();
        let v = build_default_json_skeleton(&desc);
        assert_eq!(v["v"], expected, "skeleton default for {wkt_short}");
    }

    #[test]
    fn wrapper_wkts_collapse_to_bare_scalar() {
        assert_wkt_skeleton("Int64Value", json!(0));
        assert_wkt_skeleton("UInt64Value", json!(0));
        assert_wkt_skeleton("Int32Value", json!(0));
        assert_wkt_skeleton("UInt32Value", json!(0));
        assert_wkt_skeleton("DoubleValue", json!(0.0));
        assert_wkt_skeleton("FloatValue", json!(0.0));
        assert_wkt_skeleton("BoolValue", json!(false));
        assert_wkt_skeleton("StringValue", json!(""));
        assert_wkt_skeleton("BytesValue", json!(""));
    }

    #[test]
    fn timestamp_duration_fieldmask_collapse_to_string_form() {
        assert_wkt_skeleton("Timestamp", json!("1970-01-01T00:00:00Z"));
        assert_wkt_skeleton("Duration", json!("0s"));
        assert_wkt_skeleton("FieldMask", json!(""));
    }

    #[test]
    fn non_wkt_message_still_expands_to_object() {
        // A user message that happens to live under a different package but
        // looks like a wrapper must still expand as an ordinary message.
        let mut inner_field = scalar_field("value", 1, Ty::Int64);
        inner_field.r#type = Some(Ty::Int64 as i32);
        let inner = msg("Int64Value", vec![inner_field]); // t.Int64Value, NOT google.protobuf
        let mut f = scalar_field("v", 1, Ty::Message);
        f.type_name = Some(".t.Int64Value".into());
        let outer = msg("M", vec![f]);
        let pool = pool_with(FileDescriptorSet {
            file: vec![FileDescriptorProto {
                name: Some("t.proto".into()),
                package: Some("t".into()),
                syntax: Some("proto3".into()),
                message_type: vec![outer, inner],
                ..Default::default()
            }],
        });
        let desc = pool.get_message_by_name("t.M").unwrap();
        let v = build_default_json_skeleton(&desc);
        assert_eq!(v["v"], json!({ "value": 0 }), "same-name non-WKT must expand");
    }

    #[test]
    fn empty_wkt_is_not_collapsed_and_stays_an_object() {
        // google.protobuf.Empty is NOT a scalar WKT; it expands via the
        // ordinary message path and (having no fields) yields `{}`.
        let pool = wkt_field_pool("Empty");
        let desc = pool.get_message_by_name("t.M").unwrap();
        let v = build_default_json_skeleton(&desc);
        assert_eq!(v["v"], json!({}), "Empty must stay an object, not collapse");
    }

    /// Repro for the bug: a `google.protobuf.Int64Value` field skeleton must
    /// round-trip through `prost_reflect::DynamicMessage::deserialize`. Before
    /// the fix the skeleton was `{"limit": {"value": 0}}`, which the proto3-JSON
    /// deserializer rejects with
    /// `invalid type: map, expected a 64-bit signed integer or decimal string`.
    #[test]
    fn int64value_skeleton_deserializes_against_descriptor() {
        let mut f = scalar_field("limit", 1, Ty::Message);
        f.type_name = Some(".google.protobuf.Int64Value".into());
        let m = msg("M", vec![f]);
        let pool = pool_with(FileDescriptorSet {
            file: vec![
                well_known_file(),
                FileDescriptorProto {
                    name: Some("t.proto".into()),
                    package: Some("t".into()),
                    syntax: Some("proto3".into()),
                    dependency: vec!["google/protobuf/wrappers.proto".into()],
                    message_type: vec![m],
                    ..Default::default()
                },
            ],
        });
        let desc = pool.get_message_by_name("t.M").unwrap();
        let json = serde_json::to_string(&build_default_json_skeleton(&desc)).unwrap();

        let mut de = serde_json::Deserializer::from_str(&json);
        let result = prost_reflect::DynamicMessage::deserialize(desc.clone(), &mut de);
        assert!(
            result.is_ok(),
            "Int64Value skeleton `{json}` must deserialize, got: {:?}",
            result.err()
        );
    }
}
