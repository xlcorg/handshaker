//! IPC-facing wrappers around `handshaker_core::grpc::MessageSchema`.
//!
//! Keeps handshaker-core specta-free. Conversion is cheap (Vec/String moves, no I/O).

use handshaker_core::grpc::{EnumNode, EnumValueNode, FieldNode, FieldValueKind, MessageNode, MessageSchema, MessageSide};
use serde::{Deserialize, Serialize};
use specta::Type;

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct MessageSchemaIpc {
    pub root: String,
    pub messages: Vec<MessageNodeIpc>,
    pub enums: Vec<EnumNodeIpc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct MessageNodeIpc {
    pub full_name: String,
    pub fields: Vec<FieldNodeIpc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct FieldNodeIpc {
    pub json_name: String,
    pub proto_name: String,
    pub type_label: String,
    pub value_kind: FieldValueKindIpc,
    pub repeated: bool,
    pub message_type: Option<String>,
    pub enum_type: Option<String>,
    pub oneof_group: Option<String>,
    pub number: u32,
    pub optional: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct EnumValueIpc {
    pub name: String,
    pub number: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct EnumNodeIpc {
    pub full_name: String,
    pub values: Vec<EnumValueIpc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum FieldValueKindIpc {
    Scalar,
    Message,
    Enum,
    Map,
}

impl From<MessageSchema> for MessageSchemaIpc {
    fn from(s: MessageSchema) -> Self {
        Self {
            root: s.root,
            messages: s.messages.into_iter().map(Into::into).collect(),
            enums: s.enums.into_iter().map(Into::into).collect(),
        }
    }
}

impl From<MessageNode> for MessageNodeIpc {
    fn from(m: MessageNode) -> Self {
        Self {
            full_name: m.full_name,
            fields: m.fields.into_iter().map(Into::into).collect(),
        }
    }
}

impl From<FieldNode> for FieldNodeIpc {
    fn from(f: FieldNode) -> Self {
        Self {
            json_name: f.json_name,
            proto_name: f.proto_name,
            type_label: f.type_label,
            value_kind: f.value_kind.into(),
            repeated: f.repeated,
            message_type: f.message_type,
            enum_type: f.enum_type,
            oneof_group: f.oneof_group,
            number: f.number,
            optional: f.optional,
        }
    }
}

impl From<EnumValueNode> for EnumValueIpc {
    fn from(v: EnumValueNode) -> Self {
        Self { name: v.name, number: v.number }
    }
}

impl From<EnumNode> for EnumNodeIpc {
    fn from(e: EnumNode) -> Self {
        Self {
            full_name: e.full_name,
            values: e.values.into_iter().map(Into::into).collect(),
        }
    }
}

impl From<FieldValueKind> for FieldValueKindIpc {
    fn from(k: FieldValueKind) -> Self {
        match k {
            FieldValueKind::Scalar => Self::Scalar,
            FieldValueKind::Message => Self::Message,
            FieldValueKind::Enum => Self::Enum,
            FieldValueKind::Map => Self::Map,
        }
    }
}

/// Which side of the method the schema is built from.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum MessageSideIpc {
    Input,
    Output,
}

impl From<MessageSideIpc> for MessageSide {
    fn from(s: MessageSideIpc) -> Self {
        match s {
            MessageSideIpc::Input => MessageSide::Input,
            MessageSideIpc::Output => MessageSide::Output,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn side_converts_to_core() {
        assert!(matches!(MessageSide::from(MessageSideIpc::Input), MessageSide::Input));
        assert!(matches!(MessageSide::from(MessageSideIpc::Output), MessageSide::Output));
    }

    #[test]
    fn from_core_maps_fields() {
        let core = MessageSchema {
            root: "t.M".into(),
            messages: vec![MessageNode {
                full_name: "t.M".into(),
                fields: vec![FieldNode {
                    json_name: "aStr".into(),
                    proto_name: "a_str".into(),
                    type_label: "string".into(),
                    value_kind: FieldValueKind::Scalar,
                    repeated: false,
                    message_type: None,
                    enum_type: None,
                    oneof_group: None,
                    number: 1,
                    optional: false,
                }],
            }],
            enums: vec![EnumNode {
                full_name: "t.E".into(),
                values: vec![EnumValueNode { name: "A".into(), number: 0 }],
            }],
        };
        let ipc: MessageSchemaIpc = core.into();
        assert_eq!(ipc.root, "t.M");
        assert_eq!(ipc.messages[0].fields[0].json_name, "aStr");
        assert!(matches!(ipc.messages[0].fields[0].value_kind, FieldValueKindIpc::Scalar));
        assert_eq!(ipc.enums[0].values[0].name, "A");
    }
}
