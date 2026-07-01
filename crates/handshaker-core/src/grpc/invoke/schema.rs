//! Flat field-schema for a method's input or output message — drives request-body autocomplete and the contract view.
//!
//! Unlike `skeleton` (which inlines default values with a depth cap), this references
//! message/enum types by full-name in flat maps, so recursive/self-referential types
//! terminate naturally with no depth cap. See
//! `docs/superpowers/specs/2026-06-10-body-autocomplete-schema-design.md`.

use crate::error::CoreError;
use prost_reflect::{DescriptorPool, EnumDescriptor, FieldDescriptor, Kind, MessageDescriptor};
use std::collections::{HashSet, VecDeque};

/// Flat schema for one method's input or output message. Types are referenced by full-name
/// (see `messages`/`enums`), NOT inlined — recursion-safe.
#[derive(Debug, Clone, PartialEq)]
pub struct MessageSchema {
    pub root: String,
    pub messages: Vec<MessageNode>,
    pub enums: Vec<EnumNode>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct MessageNode {
    pub full_name: String,
    pub fields: Vec<FieldNode>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct FieldNode {
    /// The field's proto3-JSON (lowerCamelCase) name.
    pub json_name: String,
    /// The proto (snake_case) field name — as in the `.proto` and the Contract tab.
    pub proto_name: String,
    /// Human label, e.g. `string`, `repeated Address`, `map<string, int32>`, `Status`.
    pub type_label: String,
    pub value_kind: FieldValueKind,
    /// `true` for `repeated` (NOT for map).
    pub repeated: bool,
    /// full-name to DESCEND into: a singular/repeated message, or a map's value-message.
    pub message_type: Option<String>,
    /// full-name of the enum for value suggestions: an enum field, or a map's value-enum.
    pub enum_type: Option<String>,
    /// oneof name if this field is a member (for the contract view; completion ignores it).
    pub oneof_group: Option<String>,
    /// Proto field number (`= N;` in the contract view).
    pub number: u32,
    /// proto3 `optional` (a synthetic single-field `_<name>` oneof in descriptors).
    pub optional: bool,
}

#[derive(Debug, Clone, PartialEq)]
pub struct EnumValueNode {
    pub name: String,
    pub number: i32,
}

#[derive(Debug, Clone, PartialEq)]
pub struct EnumNode {
    pub full_name: String,
    pub values: Vec<EnumValueNode>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum FieldValueKind {
    Scalar,
    Message,
    Enum,
    Map,
}

/// Which side of a method the schema is built from.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MessageSide {
    Input,
    Output,
}

/// Build a flat schema for the given method's input or output message from a
/// descriptor pool.
pub fn build_message_schema_from_pool(
    pool: &DescriptorPool,
    service: &str,
    method: &str,
    side: MessageSide,
) -> Result<MessageSchema, CoreError> {
    let svc = pool
        .get_service_by_name(service)
        .ok_or_else(|| CoreError::ServiceNotFound {
            service: service.to_string(),
        })?;
    let m = svc
        .methods()
        .find(|m| m.name() == method)
        .ok_or_else(|| CoreError::MethodNotFound {
            service: service.to_string(),
            method: method.to_string(),
        })?;
    Ok(build_schema(&match side {
        MessageSide::Input => m.input(),
        MessageSide::Output => m.output(),
    }))
}

/// BFS over the message graph from `root`, emitting one `MessageNode` per reachable
/// message and one `EnumNode` per reachable enum. Deduped by full-name; cycle-safe.
fn build_schema(root: &MessageDescriptor) -> MessageSchema {
    let mut messages = Vec::new();
    let mut enums = Vec::new();
    let mut visited_msgs: HashSet<String> = HashSet::new();
    let mut visited_enums: HashSet<String> = HashSet::new();
    let mut queue: VecDeque<MessageDescriptor> = VecDeque::new();

    visited_msgs.insert(root.full_name().to_string());
    queue.push_back(root.clone());

    while let Some(desc) = queue.pop_front() {
        let fields = desc
            .fields()
            .map(|f| build_field(&f, &mut queue, &mut visited_msgs, &mut enums, &mut visited_enums))
            .collect();
        messages.push(MessageNode {
            full_name: desc.full_name().to_string(),
            fields,
        });
    }

    MessageSchema {
        root: root.full_name().to_string(),
        messages,
        enums,
    }
}

fn build_field(
    field: &FieldDescriptor,
    queue: &mut VecDeque<MessageDescriptor>,
    visited_msgs: &mut HashSet<String>,
    enums: &mut Vec<EnumNode>,
    visited_enums: &mut HashSet<String>,
) -> FieldNode {
    let json_name = field.json_name().to_string();
    let proto_name = field.name().to_string();
    let (oneof_group, optional) = oneof_info(field);
    let number = field.number();

    if field.is_map() {
        let entry = match field.kind() {
            Kind::Message(m) => m,
            _ => unreachable!("is_map() implies a message (map-entry) kind"),
        };
        let key_label = scalar_label(&entry.map_entry_key_field().kind());
        let value_field = entry.map_entry_value_field();
        let (value_label, message_type, enum_type) = match value_field.kind() {
            Kind::Message(m) => {
                enqueue_message(&m, queue, visited_msgs);
                (short_name(m.full_name()), Some(m.full_name().to_string()), None)
            }
            Kind::Enum(e) => {
                record_enum(&e, enums, visited_enums);
                (short_name(e.full_name()), None, Some(e.full_name().to_string()))
            }
            other => (scalar_label(&other).to_string(), None, None),
        };
        return FieldNode {
            json_name,
            proto_name,
            type_label: format!("map<{key_label}, {value_label}>"),
            value_kind: FieldValueKind::Map,
            repeated: false,
            message_type,
            enum_type,
            oneof_group,
            number,
            optional,
        };
    }

    let repeated = field.is_list();
    let (value_kind, base_label, message_type, enum_type) = match field.kind() {
        Kind::Message(m) => {
            enqueue_message(&m, queue, visited_msgs);
            (
                FieldValueKind::Message,
                short_name(m.full_name()),
                Some(m.full_name().to_string()),
                None,
            )
        }
        Kind::Enum(e) => {
            record_enum(&e, enums, visited_enums);
            (
                FieldValueKind::Enum,
                short_name(e.full_name()),
                None,
                Some(e.full_name().to_string()),
            )
        }
        other => (FieldValueKind::Scalar, scalar_label(&other).to_string(), None, None),
    };
    let type_label = if repeated {
        format!("repeated {base_label}")
    } else {
        base_label
    };

    FieldNode {
        json_name,
        proto_name,
        type_label,
        value_kind,
        repeated,
        message_type,
        enum_type,
        oneof_group,
        number,
        optional,
    }
}

fn enqueue_message(
    m: &MessageDescriptor,
    queue: &mut VecDeque<MessageDescriptor>,
    visited: &mut HashSet<String>,
) {
    if visited.insert(m.full_name().to_string()) {
        queue.push_back(m.clone());
    }
}

fn record_enum(e: &EnumDescriptor, enums: &mut Vec<EnumNode>, visited: &mut HashSet<String>) {
    if visited.insert(e.full_name().to_string()) {
        enums.push(EnumNode {
            full_name: e.full_name().to_string(),
            values: e
                .values()
                .map(|v| EnumValueNode { name: v.name().to_string(), number: v.number() })
                .collect(),
        });
    }
}

fn short_name(full: &str) -> String {
    full.rsplit('.').next().unwrap_or(full).to_string()
}

/// Real oneof name + proto3 `optional` flag. proto3 `optional` synthesizes a
/// single-field oneof named `_<field>`; that synthetic oneof is reported as
/// `optional` instead of a phantom group.
fn oneof_info(field: &FieldDescriptor) -> (Option<String>, bool) {
    match field.containing_oneof() {
        None => (None, false),
        Some(oneof) => {
            let synthetic = oneof.fields().count() == 1 && oneof.name().starts_with('_');
            if synthetic {
                (None, true)
            } else {
                (Some(oneof.name().to_string()), false)
            }
        }
    }
}

fn scalar_label(kind: &Kind) -> &'static str {
    use Kind::*;
    match kind {
        Double => "double",
        Float => "float",
        Int32 => "int32",
        Int64 => "int64",
        Uint32 => "uint32",
        Uint64 => "uint64",
        Sint32 => "sint32",
        Sint64 => "sint64",
        Fixed32 => "fixed32",
        Fixed64 => "fixed64",
        Sfixed32 => "sfixed32",
        Sfixed64 => "sfixed64",
        Bool => "bool",
        String => "string",
        Bytes => "bytes",
        // Not reachable for map keys (always scalar) or the scalar arm above; safe fallback.
        Message(_) | Enum(_) => "message",
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use prost::Message as _;
    use prost_types::field_descriptor_proto::{Label, Type as Ty};
    use prost_types::{
        DescriptorProto, EnumDescriptorProto, EnumValueDescriptorProto, FieldDescriptorProto,
        FileDescriptorProto, FileDescriptorSet, MessageOptions, MethodDescriptorProto,
        OneofDescriptorProto, ServiceDescriptorProto,
    };

    fn pool_with(file: FileDescriptorProto) -> DescriptorPool {
        let set = FileDescriptorSet { file: vec![file] };
        let mut pool = DescriptorPool::new();
        let mut buf = Vec::new();
        set.encode(&mut buf).expect("encode");
        let decoded = FileDescriptorSet::decode(&buf[..]).expect("roundtrip");
        pool.add_file_descriptor_set(decoded).expect("add");
        pool
    }

    fn field(name: &str, number: i32, ty: Ty) -> FieldDescriptorProto {
        FieldDescriptorProto {
            name: Some(name.into()),
            number: Some(number),
            r#type: Some(ty as i32),
            label: Some(Label::Optional as i32),
            ..Default::default()
        }
    }

    fn file(package: &str, messages: Vec<DescriptorProto>) -> FileDescriptorProto {
        file_with_enums(package, messages, vec![])
    }

    fn file_with_enums(
        package: &str,
        messages: Vec<DescriptorProto>,
        enums: Vec<EnumDescriptorProto>,
    ) -> FileDescriptorProto {
        FileDescriptorProto {
            name: Some(format!("{package}.proto")),
            package: Some(package.into()),
            syntax: Some("proto3".into()),
            message_type: messages,
            enum_type: enums,
            ..Default::default()
        }
    }

    /// A hand-built `google.protobuf` file with the well-known types this fix
    /// touches, so a field can reference e.g. `.google.protobuf.Int64Value`.
    fn well_known_file() -> FileDescriptorProto {
        let wrapper = |name: &str, ty: Ty| DescriptorProto {
            name: Some(name.into()),
            field: vec![field("value", 1, ty)],
            ..Default::default()
        };
        FileDescriptorProto {
            name: Some("google/protobuf/wrappers.proto".into()),
            package: Some("google.protobuf".into()),
            syntax: Some("proto3".into()),
            message_type: vec![
                wrapper("Int64Value", Ty::Int64),
                wrapper("StringValue", Ty::String),
                wrapper("BoolValue", Ty::Bool),
                wrapper("DoubleValue", Ty::Double),
                DescriptorProto {
                    name: Some("Timestamp".into()),
                    field: vec![field("seconds", 1, Ty::Int64), field("nanos", 2, Ty::Int32)],
                    ..Default::default()
                },
                DescriptorProto {
                    name: Some("Empty".into()),
                    field: vec![],
                    ..Default::default()
                },
                DescriptorProto {
                    name: Some("Duration".into()),
                    field: vec![field("seconds", 1, Ty::Int64), field("nanos", 2, Ty::Int32)],
                    ..Default::default()
                },
                DescriptorProto {
                    name: Some("FieldMask".into()),
                    field: vec![field("paths", 1, Ty::String)],
                    ..Default::default()
                },
            ],
            ..Default::default()
        }
    }

    fn pool_with_files(files: Vec<FileDescriptorProto>) -> DescriptorPool {
        let set = FileDescriptorSet { file: files };
        let mut pool = DescriptorPool::new();
        let mut buf = Vec::new();
        set.encode(&mut buf).expect("encode");
        let decoded = FileDescriptorSet::decode(&buf[..]).expect("roundtrip");
        pool.add_file_descriptor_set(decoded).expect("add");
        pool
    }

    fn msg_node<'a>(s: &'a MessageSchema, full: &str) -> &'a MessageNode {
        s.messages.iter().find(|m| m.full_name == full).expect("message present")
    }

    fn field_node<'a>(m: &'a MessageNode, json: &str) -> &'a FieldNode {
        m.fields.iter().find(|f| f.json_name == json).expect("field present")
    }

    #[test]
    fn scalars_carry_label_jsonname_and_kind() {
        let m = DescriptorProto {
            name: Some("M".into()),
            field: vec![
                field("a_str", 1, Ty::String),
                field("a_num", 2, Ty::Int32),
                field("a_bool", 3, Ty::Bool),
            ],
            ..Default::default()
        };
        let pool = pool_with(file("t", vec![m]));
        let schema = build_schema(&pool.get_message_by_name("t.M").unwrap());

        assert_eq!(schema.root, "t.M");
        let root = msg_node(&schema, "t.M");
        let s = field_node(root, "aStr");
        assert_eq!(s.type_label, "string");
        assert_eq!(s.proto_name, "a_str");
        assert_eq!(s.value_kind, FieldValueKind::Scalar);
        assert!(!s.repeated);
        assert_eq!(field_node(root, "aNum").type_label, "int32");
        assert_eq!(field_node(root, "aBool").type_label, "bool");
    }

    #[test]
    fn repeated_scalar_is_flagged_and_labeled() {
        let mut f = field("items", 1, Ty::String);
        f.label = Some(Label::Repeated as i32);
        let m = DescriptorProto {
            name: Some("M".into()),
            field: vec![f],
            ..Default::default()
        };
        let pool = pool_with(file("t", vec![m]));
        let schema = build_schema(&pool.get_message_by_name("t.M").unwrap());
        let n = field_node(msg_node(&schema, "t.M"), "items");
        assert!(n.repeated);
        assert_eq!(n.type_label, "repeated string");
        assert_eq!(n.value_kind, FieldValueKind::Scalar);
    }

    #[test]
    fn enum_field_records_enum_node_with_values() {
        let e = EnumDescriptorProto {
            name: Some("Status".into()),
            value: vec![
                EnumValueDescriptorProto { name: Some("UNKNOWN".into()), number: Some(0), ..Default::default() },
                EnumValueDescriptorProto { name: Some("ACTIVE".into()), number: Some(1), ..Default::default() },
            ],
            ..Default::default()
        };
        let mut f = field("status", 1, Ty::Enum);
        f.type_name = Some(".t.Status".into());
        let m = DescriptorProto {
            name: Some("M".into()),
            field: vec![f],
            ..Default::default()
        };
        let pool = pool_with(file_with_enums("t", vec![m], vec![e]));
        let schema = build_schema(&pool.get_message_by_name("t.M").unwrap());

        let n = field_node(msg_node(&schema, "t.M"), "status");
        assert_eq!(n.value_kind, FieldValueKind::Enum);
        assert_eq!(n.enum_type.as_deref(), Some("t.Status"));
        assert_eq!(n.type_label, "Status");
        let en = schema.enums.iter().find(|e| e.full_name == "t.Status").expect("enum node");
        assert_eq!(
            en.values,
            vec![
                EnumValueNode { name: "UNKNOWN".into(), number: 0 },
                EnumValueNode { name: "ACTIVE".into(), number: 1 },
            ]
        );
    }

    #[test]
    fn fields_carry_numbers_and_proto3_optional_flag() {
        // Same message shape as real_oneof_is_reported_synthetic_is_not:
        // a(=1, oneof choice), b(=2, oneof choice), nick(=3, proto3 optional).
        let mut a = field("a", 1, Ty::String);
        a.oneof_index = Some(0);
        let mut b = field("b", 2, Ty::Int32);
        b.oneof_index = Some(0);
        let mut opt = field("nick", 3, Ty::String);
        opt.proto3_optional = Some(true);
        opt.oneof_index = Some(1);
        let m = DescriptorProto {
            name: Some("M".into()),
            field: vec![a, b, opt],
            oneof_decl: vec![
                OneofDescriptorProto { name: Some("choice".into()), ..Default::default() },
                OneofDescriptorProto { name: Some("_nick".into()), ..Default::default() },
            ],
            ..Default::default()
        };
        let pool = pool_with(file("t", vec![m]));
        let schema = build_schema(&pool.get_message_by_name("t.M").unwrap());
        let root = msg_node(&schema, "t.M");

        assert_eq!(field_node(root, "a").number, 1);
        assert_eq!(field_node(root, "b").number, 2);
        assert_eq!(field_node(root, "nick").number, 3);
        assert!(field_node(root, "nick").optional);
        assert!(!field_node(root, "a").optional);
        assert!(!field_node(root, "b").optional);
    }

    #[test]
    fn nested_message_is_referenced_and_in_closure() {
        let mut f = field("addr", 1, Ty::Message);
        f.type_name = Some(".t.Address".into());
        let parent = DescriptorProto {
            name: Some("M".into()),
            field: vec![f],
            ..Default::default()
        };
        let address = DescriptorProto {
            name: Some("Address".into()),
            field: vec![field("city", 1, Ty::String)],
            ..Default::default()
        };
        let pool = pool_with(file("t", vec![parent, address]));
        let schema = build_schema(&pool.get_message_by_name("t.M").unwrap());

        let n = field_node(msg_node(&schema, "t.M"), "addr");
        assert_eq!(n.value_kind, FieldValueKind::Message);
        assert_eq!(n.message_type.as_deref(), Some("t.Address"));
        assert_eq!(n.type_label, "Address");
        assert_eq!(field_node(msg_node(&schema, "t.Address"), "city").type_label, "string");
    }

    #[test]
    fn map_scalar_value() {
        let entry = DescriptorProto {
            name: Some("CountsEntry".into()),
            field: vec![field("key", 1, Ty::String), field("value", 2, Ty::Int32)],
            options: Some(MessageOptions { map_entry: Some(true), ..Default::default() }),
            ..Default::default()
        };
        let mut f = field("counts", 1, Ty::Message);
        f.type_name = Some(".t.M.CountsEntry".into());
        f.label = Some(Label::Repeated as i32);
        let m = DescriptorProto {
            name: Some("M".into()),
            field: vec![f],
            nested_type: vec![entry],
            ..Default::default()
        };
        let pool = pool_with(file("t", vec![m]));
        let schema = build_schema(&pool.get_message_by_name("t.M").unwrap());

        let n = field_node(msg_node(&schema, "t.M"), "counts");
        assert_eq!(n.value_kind, FieldValueKind::Map);
        assert!(!n.repeated);
        assert_eq!(n.type_label, "map<string, int32>");
        assert_eq!(n.message_type, None);
        assert_eq!(n.enum_type, None);
    }

    #[test]
    fn map_message_value_descends() {
        let entry = DescriptorProto {
            name: Some("PeopleEntry".into()),
            field: vec![
                field("key", 1, Ty::String),
                {
                    let mut v = field("value", 2, Ty::Message);
                    v.type_name = Some(".t.Person".into());
                    v
                },
            ],
            options: Some(MessageOptions { map_entry: Some(true), ..Default::default() }),
            ..Default::default()
        };
        let mut f = field("people", 1, Ty::Message);
        f.type_name = Some(".t.M.PeopleEntry".into());
        f.label = Some(Label::Repeated as i32);
        let m = DescriptorProto {
            name: Some("M".into()),
            field: vec![f],
            nested_type: vec![entry],
            ..Default::default()
        };
        let person = DescriptorProto {
            name: Some("Person".into()),
            field: vec![field("name", 1, Ty::String)],
            ..Default::default()
        };
        let pool = pool_with(file("t", vec![m, person]));
        let schema = build_schema(&pool.get_message_by_name("t.M").unwrap());

        let n = field_node(msg_node(&schema, "t.M"), "people");
        assert_eq!(n.value_kind, FieldValueKind::Map);
        assert_eq!(n.type_label, "map<string, Person>");
        assert_eq!(n.message_type.as_deref(), Some("t.Person"));
        assert_eq!(field_node(msg_node(&schema, "t.Person"), "name").type_label, "string");
    }

    #[test]
    fn self_referential_message_terminates_once() {
        let mut child = field("child", 1, Ty::Message);
        child.type_name = Some(".t.Node".into());
        let node = DescriptorProto {
            name: Some("Node".into()),
            field: vec![child, field("label", 2, Ty::String)],
            ..Default::default()
        };
        let pool = pool_with(file("t", vec![node]));
        let schema = build_schema(&pool.get_message_by_name("t.Node").unwrap());

        assert_eq!(schema.messages.iter().filter(|m| m.full_name == "t.Node").count(), 1);
        let n = field_node(msg_node(&schema, "t.Node"), "child");
        assert_eq!(n.message_type.as_deref(), Some("t.Node"));
    }

    #[test]
    fn real_oneof_is_reported_synthetic_is_not() {
        let mut a = field("a", 1, Ty::String);
        a.oneof_index = Some(0);
        let mut b = field("b", 2, Ty::Int32);
        b.oneof_index = Some(0);
        let mut opt = field("nick", 3, Ty::String);
        opt.proto3_optional = Some(true);
        opt.oneof_index = Some(1);
        let m = DescriptorProto {
            name: Some("M".into()),
            field: vec![a, b, opt],
            oneof_decl: vec![
                OneofDescriptorProto { name: Some("choice".into()), ..Default::default() },
                OneofDescriptorProto { name: Some("_nick".into()), ..Default::default() },
            ],
            ..Default::default()
        };
        let pool = pool_with(file("t", vec![m]));
        let schema = build_schema(&pool.get_message_by_name("t.M").unwrap());
        let root = msg_node(&schema, "t.M");

        assert_eq!(field_node(root, "a").oneof_group.as_deref(), Some("choice"));
        assert_eq!(field_node(root, "b").oneof_group.as_deref(), Some("choice"));
        assert_eq!(field_node(root, "nick").oneof_group, None);
    }

    #[test]
    fn unknown_service_and_method_error() {
        let m = DescriptorProto {
            name: Some("M".into()),
            field: vec![field("x", 1, Ty::String)],
            ..Default::default()
        };
        let svc = ServiceDescriptorProto {
            name: Some("Svc".into()),
            method: vec![MethodDescriptorProto {
                name: Some("Call".into()),
                input_type: Some(".t.M".into()),
                output_type: Some(".t.M".into()),
                ..Default::default()
            }],
            ..Default::default()
        };
        let mut f = file("t", vec![m]);
        f.service = vec![svc];
        let pool = pool_with(f);

        let ok = build_message_schema_from_pool(&pool, "t.Svc", "Call", MessageSide::Input).unwrap();
        assert_eq!(ok.root, "t.M");

        assert!(matches!(
            build_message_schema_from_pool(&pool, "t.Nope", "Call", MessageSide::Input),
            Err(CoreError::ServiceNotFound { .. })
        ));
        assert!(matches!(
            build_message_schema_from_pool(&pool, "t.Svc", "Nope", MessageSide::Input),
            Err(CoreError::MethodNotFound { .. })
        ));
    }

    #[test]
    fn side_selects_input_or_output_root() {
        let m_in = DescriptorProto {
            name: Some("In".into()),
            field: vec![field("a", 1, Ty::String)],
            ..Default::default()
        };
        let m_out = DescriptorProto {
            name: Some("Out".into()),
            field: vec![field("b", 1, Ty::Int32)],
            ..Default::default()
        };
        let svc = ServiceDescriptorProto {
            name: Some("Svc".into()),
            method: vec![MethodDescriptorProto {
                name: Some("Call".into()),
                input_type: Some(".t.In".into()),
                output_type: Some(".t.Out".into()),
                ..Default::default()
            }],
            ..Default::default()
        };
        let mut f = file("t", vec![m_in, m_out]);
        f.service = vec![svc];
        let pool = pool_with(f);

        let input = build_message_schema_from_pool(&pool, "t.Svc", "Call", MessageSide::Input).unwrap();
        assert_eq!(input.root, "t.In");
        let output = build_message_schema_from_pool(&pool, "t.Svc", "Call", MessageSide::Output).unwrap();
        assert_eq!(output.root, "t.Out");
        assert!(output.messages.iter().any(|m| m.full_name == "t.Out"));
    }

    #[test]
    fn scalar_wkt_field_stays_an_ordinary_message_with_its_real_name() {
        // Schema is faithful to reflection: a wrapper is a plain Message with its
        // real short name and its block present. The bare-scalar JSON form lives in
        // the skeleton (values) and the frontend insertion path, NOT here.
        let mut f = field("limit", 1, Ty::Message);
        f.type_name = Some(".google.protobuf.Int64Value".into());
        let m = DescriptorProto {
            name: Some("M".into()),
            field: vec![f],
            ..Default::default()
        };
        let user = FileDescriptorProto {
            name: Some("t.proto".into()),
            package: Some("t".into()),
            syntax: Some("proto3".into()),
            dependency: vec!["google/protobuf/wrappers.proto".into()],
            message_type: vec![m],
            ..Default::default()
        };
        let pool = pool_with_files(vec![well_known_file(), user]);
        let schema = build_schema(&pool.get_message_by_name("t.M").unwrap());

        let n = field_node(msg_node(&schema, "t.M"), "limit");
        assert_eq!(n.value_kind, FieldValueKind::Message);
        assert_eq!(n.type_label, "Int64Value");
        assert_eq!(n.message_type.as_deref(), Some("google.protobuf.Int64Value"));
        assert!(schema.messages.iter().any(|m| m.full_name == "google.protobuf.Int64Value"));
    }

    #[test]
    fn non_scalar_wkt_message_still_expands() {
        // google.protobuf.Empty is NOT a scalar WKT — it stays a Message node.
        let mut f = field("e", 1, Ty::Message);
        f.type_name = Some(".google.protobuf.Empty".into());
        let m = DescriptorProto {
            name: Some("M".into()),
            field: vec![f],
            ..Default::default()
        };
        let user = FileDescriptorProto {
            name: Some("t.proto".into()),
            package: Some("t".into()),
            syntax: Some("proto3".into()),
            dependency: vec!["google/protobuf/wrappers.proto".into()],
            message_type: vec![m],
            ..Default::default()
        };
        let pool = pool_with_files(vec![well_known_file(), user]);
        let schema = build_schema(&pool.get_message_by_name("t.M").unwrap());

        let n = field_node(msg_node(&schema, "t.M"), "e");
        assert_eq!(n.value_kind, FieldValueKind::Message);
        assert_eq!(n.message_type.as_deref(), Some("google.protobuf.Empty"));
        assert!(schema.messages.iter().any(|m| m.full_name == "google.protobuf.Empty"));
    }

}
