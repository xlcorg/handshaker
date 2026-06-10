# Body autocomplete + message-schema endpoint — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Status:** 🎉 DONE 2026-06-10 — feature-complete, merged to `main` ff (rebased onto
> the v0.1.11 + elision-fix tip). Commits `2328d93`…`afa5aa9` (six TDD tasks + bindings
> `61fb974` + live-test UX polish `afa5aa9`). Core tests + 681 FE tests + lint + build
> green; two-stage reviewed per task + a final whole-feature review (READY TO MERGE);
> live-verified in WebView2. Spec (archived):
> [2026-06-10-body-autocomplete-schema-design.md](../../specs/archive/2026-06-10-body-autocomplete-schema-design.md).
> Group B, part 1 of 2 (#4 autocomplete DONE; #3 contract view is the next spec — reuses
> this schema, incl. the already-shipped `proto_name`/`oneof_group` fields).

**Goal:** Context-aware Tier-2 autocomplete in the request-body editor (field keys,
enum values, value scaffolds), driven by a new backend endpoint that exposes a flat
proto message field-schema.

**Architecture:** A new IPC command `grpc_message_schema` returns a *flat* schema
(`root` + message-map + enum-map, types referenced by full-name) built from the
already-cached `prost-reflect` `DescriptorPool`. The frontend fetches it per method,
attaches it to the Monaco model via a `WeakMap`, and a single custom
`CompletionItemProvider` on the `json-with-vars` language resolves the cursor's JSON
path (pure functions) and emits suggestions.

**Tech Stack:** Rust / `prost-reflect` 0.16 · Tauri + tauri-specta · React +
`@monaco-editor/react` · Vitest + Rust `#[cfg(test)]`.

---

## Prerequisites & conventions

- `pnpm install` has run in this worktree (node_modules complete).
- `dist/` exists (the app has been built before). The `export-bindings` step compiles
  `handshaker_lib`, whose `run()` uses `generate_context!` which needs `dist/`. If a
  step fails complaining about a missing `dist/`/`frontendDist`, run `pnpm build` once
  first, then retry.
- `src/ipc/bindings.ts` is **gitignored and auto-generated** — never edit it by hand
  and never `git add` it. Regenerate with:
  `cargo run -p handshaker --bin export-bindings --features export-bindings --quiet`.
- Commit messages end with: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- Test/verify commands:
  - Core Rust: `cargo test -p handshaker-core`
  - Backend compile + bindings regen: `cargo run -p handshaker --bin export-bindings --features export-bindings --quiet`
  - Frontend tests: `pnpm test`  ·  Types/lint: `pnpm lint`  ·  Build: `pnpm build`

## File structure (what each new/changed file owns)

| file | responsibility |
|------|----------------|
| `crates/handshaker-core/src/grpc/invoke/schema.rs` | **new** — flat schema types + `build_message_schema_from_pool` + tests |
| `crates/handshaker-core/src/grpc/invoke/mod.rs` | declare `pub mod schema;` + re-export types/fn |
| `crates/handshaker-core/src/grpc/mod.rs` | re-export schema types/fn at `grpc::` level |
| `src-tauri/src/ipc/schema.rs` | **new** — `*Ipc` wrappers + `From<core>` |
| `src-tauri/src/ipc/mod.rs` | `pub mod schema;` |
| `src-tauri/src/commands/grpc.rs` | **new command** `grpc_message_schema` |
| `src-tauri/src/lib.rs` | register command (import + `collect_commands!`) |
| `src/ipc/client.ts` | `grpcMessageSchema` wrapper + add to `ipc` object |
| `src/features/workflow/actions.ts` | `fetchMessageSchemaSafe` |
| `src/features/workflow/useMessageSchema.ts` | **new** hook |
| `src/features/bodyview/completion.ts` | **new** — pure fns + WeakMap + provider registration |
| `src/features/bodyview/completion.test.ts` | **new** — pure-fn tests |
| `src/lib/monaco.ts` | call `registerBodyCompletion(monaco)` in setup |
| `src/features/workflow/CallPanel.tsx` | call `useMessageSchema`, pass `schema` down |
| `src/features/workflow/RequestTabs.tsx` | thread `schema` prop |
| `src/features/invoke/BodyEditor.tsx` | thread `schema` prop |
| `src/features/bodyview/BodyView.tsx` | attach `schema` to the model |

---

## Task 1: Core flat-schema builder (handshaker-core)

**Files:**
- Create: `crates/handshaker-core/src/grpc/invoke/schema.rs`
- Modify: `crates/handshaker-core/src/grpc/invoke/mod.rs:13` (add `pub mod schema;` + re-export)
- Modify: `crates/handshaker-core/src/grpc/mod.rs:25-27` (re-export at `grpc::` level)

- [ ] **Step 1: Create `schema.rs` with types + builder**

Create `crates/handshaker-core/src/grpc/invoke/schema.rs`:

```rust
//! Flat field-schema for a method's input message — drives request-body autocomplete.
//!
//! Unlike `skeleton` (which inlines default values with a depth cap), this references
//! message/enum types by full-name in flat maps, so recursive/self-referential types
//! terminate naturally with no depth cap. See
//! `docs/superpowers/specs/2026-06-10-body-autocomplete-schema-design.md`.

use crate::error::CoreError;
use prost_reflect::{DescriptorPool, EnumDescriptor, FieldDescriptor, Kind, MessageDescriptor};
use std::collections::{HashSet, VecDeque};

/// Flat schema for one method's input message. Types are referenced by full-name
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
    /// Key as it appears in the JSON body (matches the skeleton: `field.json_name()`).
    pub json_name: String,
    /// snake_case proto name (for the future contract view; unused by completion).
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
}

#[derive(Debug, Clone, PartialEq)]
pub struct EnumNode {
    pub full_name: String,
    pub values: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum FieldValueKind {
    Scalar,
    Message,
    Enum,
    Map,
}

/// Build a flat schema for the given method's input message from a descriptor pool.
pub fn build_message_schema_from_pool(
    pool: &DescriptorPool,
    service: &str,
    method: &str,
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
    Ok(build_schema(&m.input()))
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
    let oneof_group = real_oneof_name(field);

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
            values: e.values().map(|v| v.name().to_string()).collect(),
        });
    }
}

fn short_name(full: &str) -> String {
    full.rsplit('.').next().unwrap_or(full).to_string()
}

/// proto3 `optional` synthesizes a single-field oneof named `_<field>`. Treat such a
/// synthetic oneof as "not a oneof" so the contract view doesn't show phantom groups.
fn real_oneof_name(field: &FieldDescriptor) -> Option<String> {
    let oneof = field.containing_oneof()?;
    let synthetic = oneof.fields().len() == 1 && oneof.name().starts_with('_');
    if synthetic {
        None
    } else {
        Some(oneof.name().to_string())
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
```

- [ ] **Step 2: Wire the module exports**

In `crates/handshaker-core/src/grpc/invoke/mod.rs`, the existing line 13 is
`pub(crate) mod skeleton;`. Add directly below it:

```rust
pub mod schema;
pub use schema::{
    build_message_schema_from_pool, EnumNode, FieldNode, FieldValueKind, MessageNode,
    MessageSchema,
};
```

In `crates/handshaker-core/src/grpc/mod.rs`, replace the `pub use invoke::{...}` block
(lines 25-27) with:

```rust
pub use invoke::{
    build_message_schema_from_pool, build_request_skeleton, build_request_skeleton_from_pool,
    invoke_unary, EnumNode, FieldNode, FieldValueKind, MessageNode, MessageSchema, UnaryOutcome,
};
```

- [ ] **Step 3: Add the failing tests**

Append to `crates/handshaker-core/src/grpc/invoke/schema.rs`:

```rust
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
        // proto3 json_name is camelCase.
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
        assert_eq!(en.values, vec!["UNKNOWN".to_string(), "ACTIVE".to_string()]);
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
        // Address is in the closure with its own field.
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
        // Person is in the closure.
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

        // Node appears exactly once; `child` references it by name.
        assert_eq!(schema.messages.iter().filter(|m| m.full_name == "t.Node").count(), 1);
        let n = field_node(msg_node(&schema, "t.Node"), "child");
        assert_eq!(n.message_type.as_deref(), Some("t.Node"));
    }

    #[test]
    fn real_oneof_is_reported_synthetic_is_not() {
        // Real oneof "choice" with two members; plus a proto3 `optional` synthetic oneof.
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
        // proto3 optional → synthetic `_nick` oneof → reported as None.
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

        // Happy path: a real service+method yields a schema rooted at the input.
        let ok = build_message_schema_from_pool(&pool, "t.Svc", "Call").unwrap();
        assert_eq!(ok.root, "t.M");

        assert!(matches!(
            build_message_schema_from_pool(&pool, "t.Nope", "Call"),
            Err(CoreError::ServiceNotFound { .. })
        ));
        assert!(matches!(
            build_message_schema_from_pool(&pool, "t.Svc", "Nope"),
            Err(CoreError::MethodNotFound { .. })
        ));
    }
}
```

- [ ] **Step 4: Run the tests — expect PASS** (TDD note: types+impl land in Step 1, so
  these tests pass on first run; if any fail, fix the impl before continuing).

Run: `cargo test -p handshaker-core schema`
Expected: all `schema::tests::*` pass; no warnings about unused exports.

- [ ] **Step 5: Commit**

```bash
git add crates/handshaker-core/src/grpc/invoke/schema.rs \
        crates/handshaker-core/src/grpc/invoke/mod.rs \
        crates/handshaker-core/src/grpc/mod.rs
git commit -m "feat(core): flat message-schema builder for autocomplete

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: IPC wrappers (src-tauri)

**Files:**
- Create: `src-tauri/src/ipc/schema.rs`
- Modify: `src-tauri/src/ipc/mod.rs:1-9` (add `pub mod schema;`)

- [ ] **Step 1: Create `src-tauri/src/ipc/schema.rs`**

```rust
//! IPC-facing wrappers around `handshaker_core::grpc::MessageSchema`.
//!
//! Keeps handshaker-core specta-free. Conversion is cheap (Vec/String moves, no I/O).

use handshaker_core::grpc::{EnumNode, FieldNode, FieldValueKind, MessageNode, MessageSchema};
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
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct EnumNodeIpc {
    pub full_name: String,
    pub values: Vec<String>,
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
        }
    }
}

impl From<EnumNode> for EnumNodeIpc {
    fn from(e: EnumNode) -> Self {
        Self {
            full_name: e.full_name,
            values: e.values,
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

#[cfg(test)]
mod tests {
    use super::*;

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
                }],
            }],
            enums: vec![EnumNode { full_name: "t.E".into(), values: vec!["A".into()] }],
        };
        let ipc: MessageSchemaIpc = core.into();
        assert_eq!(ipc.root, "t.M");
        assert_eq!(ipc.messages[0].fields[0].json_name, "aStr");
        assert!(matches!(ipc.messages[0].fields[0].value_kind, FieldValueKindIpc::Scalar));
        assert_eq!(ipc.enums[0].values, vec!["A".to_string()]);
    }
}
```

- [ ] **Step 2: Declare the module**

In `src-tauri/src/ipc/mod.rs`, add `pub mod schema;` in the alphabetical module list
(after `pub mod invoke;`, before `pub mod target;`). Optionally add the re-export
`pub use schema::MessageSchemaIpc;` below the existing `pub use` block.

- [ ] **Step 3: Run the test**

Run: `cargo test -p handshaker schema --features export-bindings`
(Building `handshaker` needs `dist/`; if it errors on a missing frontend dist, run
`pnpm build` once then retry.)
Expected: `ipc::schema::tests::from_core_maps_fields` passes.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/ipc/schema.rs src-tauri/src/ipc/mod.rs
git commit -m "feat(ipc): MessageSchemaIpc wrappers + From conversions

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: Command + registration + bindings + client wrapper

**Files:**
- Modify: `src-tauri/src/commands/grpc.rs:12-20` (imports) and add the command (after `grpc_build_request_skeleton`, ~line 96)
- Modify: `src-tauri/src/lib.rs:16-19` (import) and `:32-63` (`collect_commands!`)
- Modify: `src/ipc/client.ts` (wrapper + `ipc` object)

- [ ] **Step 1: Add the command**

In `src-tauri/src/commands/grpc.rs`, extend the core import (line 12-15) to add
`build_message_schema_from_pool`:

```rust
use handshaker_core::grpc::{
    activate, build_message_schema_from_pool, build_request_skeleton_from_pool, invoke_unary,
    ContractKey, GrpcTarget, TonicTransport,
};
```

Extend the ipc import (line 20) to add `MessageSchemaIpc`:

```rust
use crate::ipc::{
    GrpcTargetIpc, InvokeOutcomeIpc, InvokeRequest, IpcError, MessageSchemaIpc, ServiceCatalogIpc,
};
```

Add the command immediately after `grpc_build_request_skeleton` (after its closing `}`
near line 96):

```rust
/// Build the flat field-schema for a method's input message (drives autocomplete).
/// Same cache discipline as `grpc_build_request_skeleton`: cache hit → build from the
/// pool; miss → `activate` first.
#[tauri::command]
#[specta::specta]
pub async fn grpc_message_schema(
    state: State<'_, AppState>,
    target: GrpcTargetIpc,
    service: String,
    method: String,
) -> Result<MessageSchemaIpc, IpcError> {
    let target = target.into_core()?;
    let key = ContractKey::from_target(&target);

    if let Some(cached) = state.contract_cache.get(&key) {
        return Ok(build_message_schema_from_pool(&cached.pool, &service, &method)?.into());
    }
    let transport = Arc::new(TonicTransport::new());
    let conn = activate(target, transport, state.contract_cache.as_ref()).await?;
    Ok(build_message_schema_from_pool(&conn.pool, &service, &method)?.into())
}
```

- [ ] **Step 2: Register the command**

In `src-tauri/src/lib.rs`, extend the grpc import (lines 16-19):

```rust
use commands::grpc::{
    grpc_build_request_skeleton, grpc_cancel, grpc_describe, grpc_invoke_oneshot,
    grpc_message_schema, grpc_refresh_contract,
};
```

Add `grpc_message_schema,` to the `collect_commands![ ... ]` list (after
`grpc_build_request_skeleton,` near line 36):

```rust
            grpc_build_request_skeleton,
            grpc_message_schema,
```

- [ ] **Step 3: Regenerate bindings (compiles the backend too)**

Run: `cargo run -p handshaker --bin export-bindings --features export-bindings --quiet`
Expected: exits 0; `src/ipc/bindings.ts` now contains `MessageSchemaIpc`,
`MessageNodeIpc`, `FieldNodeIpc`, `EnumNodeIpc`, `FieldValueKindIpc`, and a
`grpcMessageSchema` command. (Do NOT `git add` `bindings.ts` — it is gitignored.)

Verify with the Grep tool that both `grpcMessageSchema` and `MessageSchemaIpc` appear in
`src/ipc/bindings.ts`.

- [ ] **Step 4: Add the IPC client wrapper**

In `src/ipc/client.ts`: ensure `MessageSchemaIpc` is imported from `@/ipc/bindings`
(add it to the existing type import list at the top of the file). Then add the wrapper
right after `grpcBuildRequestSkeleton` (≈ line 49):

```ts
export async function grpcMessageSchema(
  target: GrpcTargetIpc,
  service: string,
  method: string,
): Promise<MessageSchemaIpc> {
  const r = await commands.grpcMessageSchema(target, service, method);
  if (r.status === "error") throw r.error;
  return r.data;
}
```

Add `grpcMessageSchema,` to the exported `ipc` object (after `grpcBuildRequestSkeleton,`
near line 217):

```ts
  grpcBuildRequestSkeleton,
  grpcMessageSchema,
```

- [ ] **Step 5: Verify types compile**

Run: `pnpm lint`
Expected: PASS (tsc finds the new `MessageSchemaIpc` type and the wrapper typechecks).

- [ ] **Step 6: Commit** (bindings.ts is gitignored — only source files are staged)

```bash
git add src-tauri/src/commands/grpc.rs src-tauri/src/lib.rs src/ipc/client.ts
git commit -m "feat(ipc): grpc_message_schema command + client wrapper

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

> 🧹 **/clear checkpoint** — backend + IPC surface complete. The schema is now
> fetchable end-to-end. Next phase is pure frontend.

---

## Task 4: Frontend fetch + schema hook

**Files:**
- Modify: `src/features/workflow/actions.ts` (add `fetchMessageSchemaSafe`; import the type)
- Create: `src/features/workflow/useMessageSchema.ts`
- Test: `src/features/workflow/useMessageSchema.test.ts`

- [ ] **Step 1: Add `fetchMessageSchemaSafe`**

In `src/features/workflow/actions.ts`, extend the bindings type import on line 2 to add
`MessageSchemaIpc`:

```ts
import type { InvokeOutcomeIpc, SavedAuthConfigIpc, AuthCredentialsIpc, MessageSchemaIpc } from "@/ipc/bindings";
```

Add this function after `buildRequestSkeletonSafe` (after its closing `}`, ≈ line 62):

```ts
/** Fetch the flat field-schema for a method's input message; never throws — returns
 *  null on any failure (no reflection / server down / unknown method). A null schema
 *  simply disables autocomplete; the editor is unaffected. */
export async function fetchMessageSchemaSafe(
  target: CallTargetInit,
  service: string,
  method: string,
): Promise<MessageSchemaIpc | null> {
  try {
    const address = await resolveAddressSafe(target.address);
    return await ipc.grpcMessageSchema({ address, tls: target.tls, skip_verify: false }, service, method);
  } catch {
    return null;
  }
}
```

- [ ] **Step 2: Write the failing hook test**

Create `src/features/workflow/useMessageSchema.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import type { MessageSchemaIpc } from "@/ipc/bindings";

const fetchMock = vi.fn();
vi.mock("./actions", () => ({
  fetchMessageSchemaSafe: (...args: unknown[]) => fetchMock(...args),
}));

import { useMessageSchema } from "./useMessageSchema";

const SCHEMA: MessageSchemaIpc = { root: "t.M", messages: [], enums: [] };

describe("useMessageSchema", () => {
  beforeEach(() => {
    fetchMock.mockReset();
  });

  it("does not fetch and returns null when method is empty", () => {
    const { result } = renderHook(() =>
      useMessageSchema({ address: "h:1", tls: false, service: "t.S", method: "" }),
    );
    expect(result.current).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fetches and returns the schema for a method", async () => {
    fetchMock.mockResolvedValue(SCHEMA);
    const { result } = renderHook(() =>
      useMessageSchema({ address: "h:1", tls: false, service: "t.S", method: "Call" }),
    );
    await waitFor(() => expect(result.current).toEqual(SCHEMA));
    expect(fetchMock).toHaveBeenCalledWith({ address: "h:1", tls: false }, "t.S", "Call");
  });
});
```

- [ ] **Step 3: Run it — expect FAIL** (module `./useMessageSchema` not found)

Run: `pnpm test -- useMessageSchema`
Expected: FAIL (cannot resolve `./useMessageSchema`).

- [ ] **Step 4: Implement the hook**

Create `src/features/workflow/useMessageSchema.ts`:

```ts
import { useEffect, useState } from "react";
import type { MessageSchemaIpc } from "@/ipc/bindings";
import { fetchMessageSchemaSafe } from "./actions";

/** Process-wide cache keyed by address|tls|service|method. Holds null results too
 *  (a method whose schema couldn't be fetched), so we don't refetch on every focus. */
const cache = new Map<string, MessageSchemaIpc | null>();

export interface SchemaTarget {
  address: string;
  tls: boolean;
  service: string;
  method: string;
}

/** Returns the flat field-schema for the given call target, or null while loading /
 *  when unavailable / when no method is selected. Refetches when the key changes. */
export function useMessageSchema(target: SchemaTarget): MessageSchemaIpc | null {
  const { address, tls, service, method } = target;
  const key = `${address}|${tls}|${service}|${method}`;
  const [schema, setSchema] = useState<MessageSchemaIpc | null>(() => cache.get(key) ?? null);

  useEffect(() => {
    if (method.trim().length === 0 || service.trim().length === 0) {
      setSchema(null);
      return;
    }
    if (cache.has(key)) {
      setSchema(cache.get(key) ?? null);
      return;
    }
    let cancelled = false;
    void fetchMessageSchemaSafe({ address, tls }, service, method).then((s) => {
      cache.set(key, s);
      if (!cancelled) setSchema(s);
    });
    return () => {
      cancelled = true;
    };
  }, [key, address, tls, service, method]);

  return schema;
}
```

- [ ] **Step 5: Run it — expect PASS**

Run: `pnpm test -- useMessageSchema`
Expected: both tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/features/workflow/actions.ts src/features/workflow/useMessageSchema.ts \
        src/features/workflow/useMessageSchema.test.ts
git commit -m "feat(workflow): fetchMessageSchemaSafe + useMessageSchema hook

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: Completion pure functions (the core logic)

**Files:**
- Create: `src/features/bodyview/completion.ts`
- Test: `src/features/bodyview/completion.test.ts`

This task implements only the **Monaco-agnostic** pieces: the cursor-context scanner,
schema descent, suggestion builders, and the `computeSuggestions` pipeline. The Monaco
provider glue + WeakMap come in Task 6.

- [ ] **Step 1: Write the failing tests**

Create `src/features/bodyview/completion.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import type { MessageSchemaIpc } from "@/ipc/bindings";
import {
  resolveCompletionContext,
  descendSchema,
  computeSuggestions,
} from "./completion";

// Schema fixture:
//   M { string title; Address addr; repeated Tag tags; Status status;
//       map<string,int32> counts; map<string,Person> people; bool done }
//   Address { string city; Status status }
//   Tag { string name }            Person { string name }
//   enum Status { UNKNOWN, ACTIVE }
const SCHEMA: MessageSchemaIpc = {
  root: "t.M",
  enums: [{ full_name: "t.Status", values: ["UNKNOWN", "ACTIVE"] }],
  messages: [
    {
      full_name: "t.M",
      fields: [
        f("title", "string", "scalar"),
        f("addr", "Address", "message", { message_type: "t.Address" }),
        f("tags", "repeated Tag", "message", { message_type: "t.Tag", repeated: true }),
        f("status", "Status", "enum", { enum_type: "t.Status" }),
        f("counts", "map<string, int32>", "map"),
        f("people", "map<string, Person>", "map", { message_type: "t.Person" }),
        f("done", "bool", "scalar"),
      ],
    },
    { full_name: "t.Address", fields: [f("city", "string", "scalar"), f("status", "Status", "enum", { enum_type: "t.Status" })] },
    { full_name: "t.Tag", fields: [f("name", "string", "scalar")] },
    { full_name: "t.Person", fields: [f("name", "string", "scalar")] },
  ],
};

function f(
  json: string,
  type_label: string,
  value_kind: "scalar" | "message" | "enum" | "map",
  extra: Partial<{ message_type: string; enum_type: string; repeated: boolean }> = {},
) {
  return {
    json_name: json,
    proto_name: json,
    type_label,
    value_kind,
    repeated: extra.repeated ?? false,
    message_type: extra.message_type ?? null,
    enum_type: extra.enum_type ?? null,
    oneof_group: null,
  };
}

const labels = (s: ReturnType<typeof computeSuggestions>) => s.map((x) => x.label);

describe("resolveCompletionContext", () => {
  it("top-level key position", () => {
    expect(resolveCompletionContext("{\n  ")).toEqual({ path: [], where: "key" });
  });
  it("key position while typing a partial key", () => {
    expect(resolveCompletionContext('{ "ti')).toEqual({ path: [], where: "key" });
  });
  it("value position after a colon", () => {
    expect(resolveCompletionContext('{ "status": ')).toEqual({ path: [], where: "value", valueField: "status" });
  });
  it("value position while typing inside a string value", () => {
    expect(resolveCompletionContext('{ "status": "AC')).toEqual({ path: [], where: "value", valueField: "status" });
  });
  it("nested object key position", () => {
    expect(resolveCompletionContext('{ "addr": { ')).toEqual({ path: ["addr"], where: "key" });
  });
  it("inside an array → value/element position with the array's key", () => {
    expect(resolveCompletionContext('{ "tags": [ ')).toEqual({ path: [], where: "value", valueField: "tags" });
  });
  it("inside an array element object → key position", () => {
    expect(resolveCompletionContext('{ "tags": [ { ')).toEqual({ path: ["tags"], where: "key" });
  });
  it("inside a map value object → key position with map-key consumed", () => {
    expect(resolveCompletionContext('{ "people": { "alice": { ')).toEqual({ path: ["people", "alice"], where: "key" });
  });
});

describe("descendSchema", () => {
  it("root", () => {
    expect(descendSchema(SCHEMA, [])).toEqual({ kind: "message", node: SCHEMA.messages[0] });
  });
  it("through a singular message", () => {
    expect(descendSchema(SCHEMA, ["addr"])).toEqual({ kind: "message", node: SCHEMA.messages[1] });
  });
  it("through a repeated message", () => {
    expect(descendSchema(SCHEMA, ["tags"])).toEqual({ kind: "message", node: SCHEMA.messages[2] });
  });
  it("a map field directly → map", () => {
    const d = descendSchema(SCHEMA, ["people"]);
    expect(d?.kind).toBe("map");
  });
  it("through a map value (map key consumed)", () => {
    expect(descendSchema(SCHEMA, ["people", "alice"])).toEqual({ kind: "message", node: SCHEMA.messages[3] });
  });
  it("unknown path → null", () => {
    expect(descendSchema(SCHEMA, ["nope"])).toBeNull();
  });
});

describe("computeSuggestions", () => {
  it("top-level keys are the root message fields", () => {
    expect(labels(computeSuggestions(SCHEMA, "{\n  "))).toEqual([
      "title", "addr", "tags", "status", "counts", "people", "done",
    ]);
  });
  it("nested message keys", () => {
    expect(labels(computeSuggestions(SCHEMA, '{ "addr": { '))).toEqual(["city", "status"]);
  });
  it("enum value suggestions after a colon", () => {
    expect(labels(computeSuggestions(SCHEMA, '{ "status": '))).toEqual(["UNKNOWN", "ACTIVE"]);
  });
  it("bool value suggestions", () => {
    expect(labels(computeSuggestions(SCHEMA, '{ "done": '))).toEqual(["true", "false"]);
  });
  it("map keys are suppressed (arbitrary)", () => {
    expect(computeSuggestions(SCHEMA, '{ "people": { ')).toEqual([]);
  });
  it("map value message keys are offered", () => {
    expect(labels(computeSuggestions(SCHEMA, '{ "people": { "alice": { '))).toEqual(["name"]);
  });
  it("scaffold for a message key is a snippet object", () => {
    const addr = computeSuggestions(SCHEMA, "{\n  ").find((s) => s.label === "addr")!;
    expect(addr.insertText).toBe('"addr": {\n\t$0\n}');
    expect(addr.isSnippet).toBe(true);
    expect(addr.triggerNext).toBe(true);
  });
  it("scaffold for a repeated key is an array", () => {
    const tags = computeSuggestions(SCHEMA, "{\n  ").find((s) => s.label === "tags")!;
    expect(tags.insertText).toBe('"tags": [$0]');
  });
  it("scaffold for a map key is an object, a string key is quoted", () => {
    const counts = computeSuggestions(SCHEMA, "{\n  ").find((s) => s.label === "counts")!;
    expect(counts.insertText).toBe('"counts": {\n\t$0\n}'); // map → object scaffold
    const title = computeSuggestions(SCHEMA, "{\n  ").find((s) => s.label === "title")!;
    expect(title.insertText).toBe('"title": "$0"'); // string → quoted
  });
  it("no schema-less crash on unparseable / unknown paths", () => {
    expect(computeSuggestions(SCHEMA, '{ "nope": { ')).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it — expect FAIL** (module `./completion` not found)

Run: `pnpm test -- completion`
Expected: FAIL (cannot resolve `./completion`).

- [ ] **Step 3: Implement `completion.ts` (pure parts)**

Create `src/features/bodyview/completion.ts`:

```ts
import type { MessageSchemaIpc, MessageNodeIpc, FieldNodeIpc } from "@/ipc/bindings";

// ---------------------------------------------------------------------------
// Cursor context — a schema-blind scanner over the text before the cursor.
// ---------------------------------------------------------------------------

export interface CompletionContext {
  /** Literal object keys from root to the enclosing object (array frames add nothing). */
  path: string[];
  where: "key" | "value";
  /** When where==="value": the literal json key whose value we're typing. */
  valueField?: string;
}

interface Frame {
  type: "object" | "array";
  /** The key that opened this container (null at root or inside an array). */
  openKey: string | null;
}

/**
 * Resolve the JSON cursor context from the text *before* the cursor. The JSON is
 * typically incomplete/invalid mid-typing, so this is a lenient char scanner, not a
 * parser. It never throws.
 */
export function resolveCompletionContext(text: string): CompletionContext {
  const stack: Frame[] = [];
  let pendingKey: string | null = null;
  let afterColon = false;
  let lastString: string | null = null;

  let i = 0;
  const n = text.length;
  while (i < n) {
    const c = text[i];
    if (c === '"') {
      // Scan a string literal; handle escapes.
      let j = i + 1;
      let buf = "";
      let terminated = false;
      while (j < n) {
        const d = text[j];
        if (d === "\\") {
          buf += text[j + 1] ?? "";
          j += 2;
          continue;
        }
        if (d === '"') {
          terminated = true;
          j += 1;
          break;
        }
        buf += d;
        j += 1;
      }
      if (!terminated) {
        // Cursor is inside this (unterminated) string — it's the token being typed.
        // Context is whatever the state was BEFORE it; stop scanning.
        break;
      }
      lastString = buf;
      i = j;
      continue;
    }

    switch (c) {
      case "{":
        stack.push({ type: "object", openKey: pendingKey });
        pendingKey = null;
        afterColon = false;
        lastString = null;
        break;
      case "[":
        stack.push({ type: "array", openKey: pendingKey });
        pendingKey = null;
        afterColon = false;
        lastString = null;
        break;
      case "}":
      case "]":
        stack.pop();
        pendingKey = null;
        afterColon = false;
        lastString = null;
        break;
      case ":":
        if (stack.length && stack[stack.length - 1].type === "object") {
          pendingKey = lastString;
          afterColon = true;
        }
        break;
      case ",":
        pendingKey = null;
        afterColon = false;
        lastString = null;
        break;
      default:
        break; // whitespace, digits, unquoted literal chars (true/false/null/numbers)
    }
    i += 1;
  }

  const top = stack[stack.length - 1];
  const pathKeys = stack.map((fr) => fr.openKey).filter((k): k is string => k !== null);

  if (!top) return { path: [], where: "key" };

  if (top.type === "array") {
    // Element/value slot; the value's owner is the array's key, owned by its parent.
    const valueField = pathKeys[pathKeys.length - 1];
    return { path: pathKeys.slice(0, -1), where: "value", valueField };
  }
  if (afterColon) {
    return { path: pathKeys, where: "value", valueField: pendingKey ?? undefined };
  }
  return { path: pathKeys, where: "key" };
}

// ---------------------------------------------------------------------------
// Schema descent.
// ---------------------------------------------------------------------------

export type Descent =
  | { kind: "message"; node: MessageNodeIpc }
  | { kind: "map"; field: FieldNodeIpc }
  | null;

export function descendSchema(schema: MessageSchemaIpc, path: string[]): Descent {
  const byName = (name: string) => schema.messages.find((m) => m.full_name === name) ?? null;
  let node = byName(schema.root);
  if (!node) return null;

  let i = 0;
  while (i < path.length) {
    const field = node.fields.find((fl) => fl.json_name === path[i]);
    if (!field) return null;
    if (field.value_kind === "map") {
      if (i + 1 >= path.length) return { kind: "map", field };
      if (!field.message_type) return null; // scalar/enum-valued map → nothing to descend
      const next = byName(field.message_type);
      if (!next) return null;
      node = next;
      i += 2; // consume the map field AND the arbitrary map key
    } else {
      if (!field.message_type) return null; // scalar/enum field → can't descend
      const next = byName(field.message_type);
      if (!next) return null;
      node = next;
      i += 1;
    }
  }
  return { kind: "message", node };
}

// ---------------------------------------------------------------------------
// Suggestion builders (Monaco-agnostic).
// ---------------------------------------------------------------------------

export interface Suggestion {
  label: string;
  detail?: string;
  insertText: string;
  kind: "field" | "message" | "enum" | "scalar" | "value";
  isSnippet?: boolean;
  /** Ask Monaco to re-trigger suggestions after accepting (next nesting level). */
  triggerNext?: boolean;
}

const NUMBER_LABELS = new Set([
  "double", "float", "int32", "int64", "uint32", "uint64",
  "sint32", "sint64", "fixed32", "fixed64", "sfixed32", "sfixed64",
]);

/** snippet body inserted after `"jsonName": ` for a key suggestion. */
function scaffold(f: FieldNodeIpc): string {
  if (f.repeated) return "[$0]";
  switch (f.value_kind) {
    case "message":
    case "map":
      return "{\n\t$0\n}";
    case "enum":
      return '"$0"';
    case "scalar":
    default:
      if (f.type_label === "bool") return "${1:false}";
      if (NUMBER_LABELS.has(f.type_label)) return "${1:0}";
      return '"$0"'; // string / bytes
  }
}

function keyKind(f: FieldNodeIpc): Suggestion["kind"] {
  switch (f.value_kind) {
    case "message":
    case "map":
      return "message";
    case "enum":
      return "enum";
    default:
      return "field";
  }
}

export function buildKeySuggestions(schema: MessageSchemaIpc, ctx: CompletionContext): Suggestion[] {
  const d = descendSchema(schema, ctx.path);
  if (!d || d.kind === "map") return []; // unknown path, or arbitrary map keys
  return d.node.fields.map((f) => ({
    label: f.json_name,
    detail: f.type_label,
    insertText: `"${f.json_name}": ${scaffold(f)}`,
    kind: keyKind(f),
    isSnippet: true,
    triggerNext: f.value_kind === "message" || f.value_kind === "enum",
  }));
}

export function buildValueSuggestions(schema: MessageSchemaIpc, ctx: CompletionContext): Suggestion[] {
  const d = descendSchema(schema, ctx.path);
  if (!d) return [];

  let field: FieldNodeIpc | undefined;
  if (d.kind === "map") {
    field = d.field; // value type of the map
  } else {
    field = d.node.fields.find((f) => f.json_name === ctx.valueField);
  }
  if (!field) return [];

  if (field.enum_type) {
    const en = schema.enums.find((e) => e.full_name === field!.enum_type);
    if (!en) return [];
    return en.values.map((v) => ({ label: v, insertText: `"${v}"`, kind: "value" as const }));
  }
  // Bool suggestions only for non-map singular/repeated bool (map-value bool is niche).
  if (d.kind === "message" && (field.type_label === "bool" || field.type_label === "repeated bool")) {
    return [
      { label: "true", insertText: "true", kind: "value" },
      { label: "false", insertText: "false", kind: "value" },
    ];
  }
  return [];
}

/** Full pipeline: text-before-cursor → suggestions. The Monaco provider wraps this. */
export function computeSuggestions(schema: MessageSchemaIpc, textBefore: string): Suggestion[] {
  const ctx = resolveCompletionContext(textBefore);
  return ctx.where === "key"
    ? buildKeySuggestions(schema, ctx)
    : buildValueSuggestions(schema, ctx);
}
```

- [ ] **Step 4: Run it — expect PASS**

Run: `pnpm test -- completion`
Expected: every `resolveCompletionContext`, `descendSchema`, and `computeSuggestions`
test passes.

- [ ] **Step 5: Commit**

```bash
git add src/features/bodyview/completion.ts src/features/bodyview/completion.test.ts
git commit -m "feat(bodyview): autocomplete pure logic (scanner, descent, suggestions)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

> 🧹 **/clear checkpoint** — all pure logic is implemented and tested. Task 6 is
> integration glue (Monaco + prop threading), best verified live in WebView2.

---

## Task 6: Monaco wiring + schema delivery

**Files:**
- Modify: `src/features/bodyview/completion.ts` (append WeakMap + provider registration)
- Modify: `src/lib/monaco.ts` (call `registerBodyCompletion`)
- Modify: `src/features/workflow/CallPanel.tsx` (call `useMessageSchema`, pass `schema`)
- Modify: `src/features/workflow/RequestTabs.tsx` (thread `schema`)
- Modify: `src/features/invoke/BodyEditor.tsx` (thread `schema`)
- Modify: `src/features/bodyview/BodyView.tsx` (attach schema to the model)

- [ ] **Step 1: Append the Monaco provider to `completion.ts`**

Add at the top of `src/features/bodyview/completion.ts` (after the existing import):

```ts
import type * as Monaco from "monaco-editor";
```

Append to the end of `src/features/bodyview/completion.ts`:

```ts
// ---------------------------------------------------------------------------
// Monaco glue — a single provider on `json-with-vars`, schema scoped per model.
// ---------------------------------------------------------------------------

const schemaByModel = new WeakMap<Monaco.editor.ITextModel, MessageSchemaIpc>();

/** Attach (or clear) the schema for a given editor model. */
export function setModelSchema(
  model: Monaco.editor.ITextModel | null,
  schema: MessageSchemaIpc | null,
): void {
  if (!model) return;
  if (schema) schemaByModel.set(model, schema);
  else schemaByModel.delete(model);
}

/** When a key is completed but a value already follows, insert only the quoted key. */
function colonAlreadyAhead(model: Monaco.editor.ITextModel, position: Monaco.Position): boolean {
  const lineEnd = model.getLineMaxColumn(position.lineNumber);
  const after = model.getValueInRange({
    startLineNumber: position.lineNumber,
    startColumn: position.column,
    endLineNumber: position.lineNumber,
    endColumn: lineEnd,
  });
  return /^\s*:/.test(after);
}

function monacoKind(monaco: typeof Monaco, kind: Suggestion["kind"]): Monaco.languages.CompletionItemKind {
  const K = monaco.languages.CompletionItemKind;
  switch (kind) {
    case "message":
      return K.Struct;
    case "enum":
      return K.Enum;
    case "value":
      return K.EnumMember;
    case "scalar":
      return K.Value;
    default:
      return K.Field;
  }
}

/** Register the request-body completion provider exactly once (called from monaco.ts). */
export function registerBodyCompletion(monaco: typeof Monaco): void {
  monaco.languages.registerCompletionItemProvider("json-with-vars", {
    triggerCharacters: ['"', ":", " "],
    provideCompletionItems(model, position) {
      const schema = schemaByModel.get(model);
      if (!schema) return { suggestions: [] };

      const textBefore = model.getValueInRange({
        startLineNumber: 1,
        startColumn: 1,
        endLineNumber: position.lineNumber,
        endColumn: position.column,
      });
      const ctx = resolveCompletionContext(textBefore);
      const items =
        ctx.where === "key" ? buildKeySuggestions(schema, ctx) : buildValueSuggestions(schema, ctx);
      if (items.length === 0) return { suggestions: [] };

      const word = model.getWordUntilPosition(position);
      const range: Monaco.IRange = {
        startLineNumber: position.lineNumber,
        endLineNumber: position.lineNumber,
        startColumn: word.startColumn,
        endColumn: word.endColumn,
      };
      const keyOnly = ctx.where === "key" && colonAlreadyAhead(model, position);

      const suggestions: Monaco.languages.CompletionItem[] = items.map((s) => {
        const asKeyOnly = keyOnly && s.kind !== "value";
        const insertText = asKeyOnly ? `"${s.label}"` : s.insertText;
        return {
          label: s.label,
          detail: s.detail,
          kind: monacoKind(monaco, s.kind),
          insertText,
          insertTextRules:
            s.isSnippet && !asKeyOnly
              ? monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet
              : undefined,
          range,
          command:
            s.triggerNext && !asKeyOnly
              ? { id: "editor.action.triggerSuggest", title: "" }
              : undefined,
        };
      });
      return { suggestions };
    },
  });
}
```

- [ ] **Step 2: Register the provider in `monaco.ts`**

In `src/lib/monaco.ts`, the language is registered at line 40
(`monaco.languages.register({ id: "json-with-vars" });`). Add an import near the other
imports and call the registrar right after that line:

At the top of the `setupPromise` body is not possible (it's an async IIFE); instead add
a static import at the top of the file:

```ts
import { registerBodyCompletion } from "@/features/bodyview/completion";
```

Then directly after `monaco.languages.register({ id: "json-with-vars" });` (line 40):

```ts
  registerBodyCompletion(monaco);
```

- [ ] **Step 3: Thread the `schema` prop through the editor components**

`src/features/invoke/BodyEditor.tsx` — add `schema` to props and pass to `BodyView`:

```tsx
import { BodyView } from "@/features/bodyview/BodyView";
import type { MessageSchemaIpc } from "@/ipc/bindings";

export interface BodyEditorProps {
  value: string;
  onChange: (next: string) => void;
  /** Ctrl/Cmd+Enter inside the editor → send (Monaco swallows the window shortcut). */
  onSubmit?: () => void;
  /** Flat field-schema for the current method; drives autocomplete (null disables it). */
  schema?: MessageSchemaIpc | null;
}

/** Request-body editor: editable Monaco (raw text) via the shared BodyView. */
export function BodyEditor({ value, onChange, onSubmit, schema }: BodyEditorProps) {
  return <BodyView mode="request" value={value} onChange={onChange} onSubmit={onSubmit} schema={schema} />;
}
```

`src/features/workflow/RequestTabs.tsx` — add `schema` to `RequestTabsProps`, accept it
in the destructure, and pass to `<BodyEditor>`. Add the import:

```tsx
import type { SavedAuthConfigIpc, MessageSchemaIpc } from "@/ipc/bindings";
```

Add to `RequestTabsProps`:

```tsx
  /** Flat field-schema for the current method; drives body autocomplete. */
  schema?: MessageSchemaIpc | null;
```

Update the signature and the BodyEditor usage:

```tsx
export function RequestTabs({ step, serviceAuth, onBody, onMetadata, onSubmit, onResetTemplate, schema }: RequestTabsProps) {
```

```tsx
          <BodyEditor value={step.requestJson} onChange={onBody} onSubmit={onSubmit} schema={schema} />
```

- [ ] **Step 4: Attach the schema to the model in `BodyView.tsx`**

In `src/features/bodyview/BodyView.tsx`:

Add two import lines (the `./controller` import already exists — leave it; just add
these two beside the other imports):

```tsx
import type { MessageSchemaIpc } from "@/ipc/bindings";
import { setModelSchema } from "./completion";
```

Add `schema` to `BodyViewProps`:

```tsx
export interface BodyViewProps {
  mode: Mode;
  value: string;
  onChange?: (next: string) => void;
  /** Ctrl/Cmd+Enter inside the editor (Monaco swallows it, so we bind a command). */
  onSubmit?: () => void;
  /** Request mode only: flat field-schema attached to the model for autocomplete. */
  schema?: MessageSchemaIpc | null;
}
```

Update the destructure and add a schema ref (mirrors `onSubmitRef`):

```tsx
export function BodyView({ mode, value, onChange, onSubmit, schema }: BodyViewProps) {
  const [prefs] = usePrefs();
  const live = useRef<Live | null>(null);
  // Ref so the Monaco command (bound once in onMount) always calls the freshest handler.
  const onSubmitRef = useRef(onSubmit);
  onSubmitRef.current = onSubmit;
  const schemaRef = useRef(schema);
  schemaRef.current = schema;
```

In `onMount`, after `live.current = { ... }` is assigned (and before/after the controller
attach is fine), attach the schema for request mode:

```tsx
      if (mode === "request") {
        setModelSchema(editor.getModel(), schemaRef.current ?? null);
      }
```

Add an effect that keeps the model's schema in sync when `schema` changes, and clears it
on unmount. Place it next to the existing unmount effect:

```tsx
  // Keep the model's attached schema current as the selected method changes.
  useEffect(() => {
    if (mode !== "request") return;
    const model = live.current?.editor.getModel();
    setModelSchema(model ?? null, schema ?? null);
  }, [schema, mode]);

  // Clear the model's schema entry when BodyView unmounts.
  useEffect(
    () => () => {
      const model = live.current?.editor.getModel();
      setModelSchema(model ?? null, null);
    },
    [],
  );
```

(The existing `useEffect(() => () => { live.current?.controller?.dispose(); }, [])` stays.)

- [ ] **Step 5: Fetch + pass the schema in `CallPanel.tsx`**

In `src/features/workflow/CallPanel.tsx`, add the import:

```tsx
import { useMessageSchema } from "./useMessageSchema";
```

Inside `CallPanel`, after `const reflection = useDraftReflection(...)` (≈ line 84), add:

```tsx
  // Autocomplete schema for the draft's method (history panels pass empty → no fetch).
  const schema = useMessageSchema(
    editable
      ? { address: step.address, tls: step.tls, service: step.service, method: step.method }
      : { address: "", tls: false, service: "", method: "" },
  );
```

Pass it to `<RequestTabs>` (add the prop alongside the existing ones):

```tsx
          <RequestTabs
            step={step}
            serviceAuth={step.auth}
            onBody={onBody}
            onMetadata={onMetadata}
            onSubmit={() => sendShortcutRef.current()}
            onResetTemplate={editable ? onResetBody : undefined}
            schema={schema}
          />
```

- [ ] **Step 6: Typecheck, test, build**

Run: `pnpm lint`
Expected: PASS (all props typecheck).

Run: `pnpm test`
Expected: full suite green (the new `completion`/`useMessageSchema` tests included; the
existing 647 unaffected).

Run: `pnpm build`
Expected: `tsc -b` + `vite build` succeed.

- [ ] **Step 7: Commit**

```bash
git add src/features/bodyview/completion.ts src/lib/monaco.ts \
        src/features/invoke/BodyEditor.tsx src/features/workflow/RequestTabs.tsx \
        src/features/bodyview/BodyView.tsx src/features/workflow/CallPanel.tsx
git commit -m "feat(bodyview): wire request-body autocomplete into Monaco

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Final verification (after all tasks)

- [ ] **Full suites green:** `cargo test -p handshaker-core` · `pnpm test` · `pnpm lint` · `pnpm build`.
- [ ] **Bindings regenerated and not committed:** `git status` shows `src/ipc/bindings.ts`
  as ignored/untracked (never staged).
- [ ] **Live WebView2 pass** (manual, as in Group A): `pnpm tauri:dev`, reflect a server,
  select a method, and in the Request body verify:
  - typing `"` inside `{}` offers the message's field keys (with type hints),
  - accepting a message/array key inserts a `{}`/`[]` scaffold and re-pops suggestions,
  - typing an enum field's value (`"`) offers the enum's value names,
  - autocomplete inside a nested object offers that nested message's keys,
  - a server with no reflection / an unselected method shows no errors (autocomplete
    simply absent).
- [ ] Dispatch a final code-reviewer over the whole branch (per subagent-driven-development).

## Notes for the executor

- **Do not edit or commit `src/ipc/bindings.ts`** — regenerate it via the export-bindings
  command; it is gitignored.
- The `value_kind` enum serializes snake_case (`"scalar"|"message"|"enum"|"map"`); the
  frontend compares against those exact strings.
- Bindings' `Option<String>` become `string | null` in TS — the fixtures and code use
  `null`, not `undefined`, for `message_type`/`enum_type`/`oneof_group`.
- If the live pass surfaces rough edges in the overwrite-guard or scaffold UX, treat them
  as follow-ups (note in the plan/CLAUDE.md) — the core flow is the deliverable.
```
