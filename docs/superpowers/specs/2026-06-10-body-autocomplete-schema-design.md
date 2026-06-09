# Body autocomplete + message-schema endpoint — design

> **Status:** approved design, ready for plan. Group B, part 1 of 2.
> Scope: backend message-schema endpoint + **#4 request-body autocomplete (Tier 2)**.
> **#3 contract view is a separate, later spec** that will reuse the same schema.

**Goal:** Context-aware autocomplete in the request-body editor — field keys, enum
values, and value scaffolds — driven by a new backend endpoint that exposes the
proto message field schema.

**Architecture:** A new IPC command returns a *flat* schema (field metadata + type
refs by full-name) for a method's input message, built from the already-cached
`prost-reflect` `DescriptorPool`. The frontend attaches the schema to the Monaco
model and a single custom `CompletionItemProvider` on the `json-with-vars` language
resolves the cursor's path and emits suggestions.

**Tech stack:** Rust / `prost-reflect` 0.16 (core) · Tauri + specta (IPC) · React +
`@monaco-editor/react` (frontend) · Vitest + Rust unit tests.

---

## Why "flat schema" (Approach A)

Rejected alternatives:

- **JSON Schema (draft-07) → Monaco built-in JSON tooling.** Monaco's native JSON
  completion/validation only runs on the `json` language via the JSON worker
  (`monaco.languages.json.jsonDefaults`). Our request editor uses the custom
  `json-with-vars` language to highlight `{{vars}}` and theme keys/strings. Switching
  to `json` loses that. Rejected.
- **JSON Schema payload + custom provider (hybrid).** Standard payload reusable for
  #3, but proto→JSON-Schema impedance (oneof→anyOf, int64→string, enum→string|int,
  well-known types, `$ref` resolution) makes the frontend resolver more complex than
  a purpose-built flat schema. The flat schema renders fine for #3 too. Rejected.

**Chosen — Approach A:** a flat schema tailored to our needs. Recursion-safe (types
referenced by full-name, not inlined), all frontend logic is pure/testable, and the
custom language keeps its highlighting.

---

## Backend

### Core — `crates/handshaker-core/src/grpc/invoke/schema.rs` (new, sibling to `skeleton.rs`)

```rust
/// Flat field-schema for one method's input message. Types are referenced by
/// full-name (see `messages`/`enums`), NOT inlined — so recursion is safe and the
/// payload stays bounded regardless of message depth.
pub struct MessageSchema {
    pub root: String,                 // full_name of the input message
    pub messages: Vec<MessageNode>,   // BFS closure of reachable messages, deduped by full_name
    pub enums: Vec<EnumNode>,         // BFS closure of reachable enums, deduped by full_name
}

pub struct MessageNode {
    pub full_name: String,
    pub fields: Vec<FieldNode>,       // in declared order
}

pub struct FieldNode {
    pub json_name: String,            // key as it appears in the JSON body (matches skeleton: field.json_name())
    pub proto_name: String,           // snake_case proto name (for #3 / hover; not used by completion)
    pub type_label: String,           // human label, built server-side (see below)
    pub value_kind: FieldValueKind,
    pub repeated: bool,               // is_list() — true for `repeated` (NOT for map)
    pub message_type: Option<String>, // full_name to DESCEND into: singular/repeated message, or a map's value-message
    pub enum_type: Option<String>,    // full_name of enum for value suggestions: enum field, or a map's value-enum
    pub oneof_group: Option<String>,  // oneof name if this field is a member (for #3; completion ignores it)
}

pub struct EnumNode {
    pub full_name: String,
    pub values: Vec<String>,          // value names in declared order (EnumDescriptor::values() → name())
}

pub enum FieldValueKind { Scalar, Message, Enum, Map }
```

**`type_label` construction (server-side, single source of truth):**

| field shape                       | `type_label`            |
|-----------------------------------|-------------------------|
| scalar `string`                   | `string`                |
| scalar `int32` (etc.)             | `int32`                 |
| singular enum `Status`            | `Status` (short name)   |
| singular message `Address`        | `Address` (short name)  |
| `repeated string`                 | `repeated string`       |
| `repeated Address`                | `repeated Address`      |
| `map<string, int32>`              | `map<string, int32>`    |
| `map<string, Address>`            | `map<string, Address>`  |

"Short name" = last dotted segment of the full-name.

**`build_message_schema_from_pool(pool, service, method) -> Result<MessageSchema, CoreError>`:**

1. Resolve service+method exactly like `build_request_skeleton_from_pool`
   (`get_service_by_name`, then `methods().find(name == method)`), returning
   `CoreError::ServiceNotFound` / `CoreError::MethodNotFound` on miss.
2. `root = m.input()`.
3. BFS from `root` over message types, with a `HashSet<String>` of visited message
   full-names (cycle-safe). For each message, emit a `MessageNode`:
   - For each `field` in `desc.fields()`:
     - `repeated = field.is_list()`.
     - Classify:
       - `field.is_map()` → `value_kind = Map`. Read the map-entry message via
         `field.kind()` (a `Kind::Message(entry)`, `entry.is_map_entry() == true`).
         Key type = `entry.map_entry_key_field().kind()` (always scalar), value field
         = `entry.map_entry_value_field()`. If the value field's kind is
         `Message(m)` → `message_type = Some(m.full_name())` and enqueue `m`;
         if `Enum(e)` → `enum_type = Some(e.full_name())` and record `e`. Build
         `type_label = "map<{key}, {value}>"`.
       - else `field.kind()`:
         - `Kind::Message(m)` → `value_kind = Message`, `message_type = Some(m.full_name())`, enqueue `m`.
         - `Kind::Enum(e)` → `value_kind = Enum`, `enum_type = Some(e.full_name())`, record `e`.
         - scalar → `value_kind = Scalar`.
     - `json_name = field.json_name()`, `proto_name = field.name()`,
       `oneof_group = field.containing_oneof().map(|o| o.name().to_string())`.
       (Skip synthetic proto3-optional oneofs — `OneofDescriptor` for a proto3
       `optional` wraps a single field; treat a oneof with exactly one field whose
       name matches `_<field>` as none. See edge cases.)
   - Enqueue any newly-referenced message full-names not yet visited.
4. For every enum recorded during the walk, emit one `EnumNode` (deduped) with
   `values = e.values().map(|v| v.name().to_string())`.
5. **No depth cap** — the flat-ref design makes a self-referential message terminate
   naturally (the message is emitted once; the field just references it by name).

Unit-tested in `schema.rs` `#[cfg(test)]` against a `DescriptorPool` built from a
`.proto` fixture (reuse the existing descriptor test infrastructure / `build_pool`).

### IPC — `src-tauri/src/ipc/schema.rs` (new) + command in `commands/grpc.rs`

Mirror `catalog.rs`: `#[derive(Serialize, Deserialize, Type)]` wrappers
`MessageSchemaIpc`, `MessageNodeIpc`, `FieldNodeIpc`, `EnumNodeIpc`, and
`FieldValueKindIpc` (a plain enum), each with a `From<core>` conversion. specta
regenerates `src/ipc/bindings.ts`.

Command (copy of the `grpc_build_request_skeleton` shape — same cache, same lazy
`activate` on miss):

```rust
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

Register the command in the Tauri builder + specta collect list alongside the other
`grpc_*` commands.

---

## Frontend

### 1. Fetch + cache

- `fetchMessageSchemaSafe(target, service, method): Promise<MessageSchemaIpc | null>`
  in `src/features/workflow/actions.ts`, beside `buildRequestSkeletonSafe`. Resolves
  the address (`resolveAddressSafe`) and calls `ipc.grpcMessageSchema`; returns
  `null` on any error (graceful degradation — no autocomplete, editor unaffected).
- `useMessageSchema({ address, tls, service, method })` hook
  (`src/features/workflow/useMessageSchema.ts`): fetches when the key
  `address|tls|service|method` changes, caches results in a module-level `Map` keyed
  by that string, returns `MessageSchemaIpc | null`. Empty/whitespace method → `null`
  (no fetch). The schema is **not** stored in `Step` — it is derived metadata.

### 2. Attach schema to the Monaco model

Thread `schema: MessageSchemaIpc | null` down: `CallPanel` (calls `useMessageSchema`)
→ `RequestTabs` → `BodyEditor` → `BodyView`.

In `BodyView` (`mode === "request"` only), attach to the model via a shared
`WeakMap<Monaco.editor.ITextModel, MessageSchemaIpc>` exported from `completion.ts`:
- in `onMount`: `schemaByModel.set(editor.getModel(), schema)` when `schema` present;
- in a `useEffect([schema])`: update/delete the model entry as `schema` changes;
- on unmount: delete the entry.

The read-only response editor never shows completions (Monaco suppresses the suggest
widget under `readOnly`) and has no `schemaByModel` entry — double isolation.

### 3. The provider (registered once)

`registerBodyCompletion(monaco)` in `src/features/bodyview/completion.ts`, called
from `src/lib/monaco.ts` setup **after** `monaco.languages.register({ id: "json-with-vars" })`.

```
monaco.languages.registerCompletionItemProvider("json-with-vars", {
  triggerCharacters: ['"', ':', ' '],   // Ctrl+Space always works too
  provideCompletionItems(model, position) {
    const schema = schemaByModel.get(model);
    if (!schema) return { suggestions: [] };
    const textBefore = model.getValueInRange({
      startLineNumber: 1, startColumn: 1,
      endLineNumber: position.lineNumber, endColumn: position.column,
    });
    const ctx = resolveCompletionContext(textBefore);
    const word = model.getWordUntilPosition(position);
    const range = { startLineNumber: position.lineNumber, endLineNumber: position.lineNumber,
                    startColumn: word.startColumn, endColumn: word.endColumn };
    const items = ctx.where === "key"
      ? buildKeySuggestions(schema, ctx)
      : buildValueSuggestions(schema, ctx);
    return { suggestions: items.map(i => toMonaco(i, range, monaco)) };
  },
});
```

### 4. Pure functions (primary TDD targets — Monaco-agnostic)

All live in `completion.ts`, tested in `completion.test.ts`.

**`resolveCompletionContext(textBefore: string): CompletionContext`** — a lightweight
scanner over the text before the cursor (the JSON is typically incomplete/invalid
mid-typing, so a real parser won't do). Tracks:
- a stack of frames `{ kind: "object" | "array", key?: string }`,
- whether the cursor is inside a string literal,
- whether, within the current object, we are after a `:` for some key (→ "value"
  position) or before it (→ "key" position).

Returns:
```ts
type CompletionContext = {
  path: string[];          // literal object keys from root to the enclosing object (array frames contribute nothing)
  where: "key" | "value";
  valueField?: string;     // when where === "value": the literal json key whose value we're typing
};
```
The scanner is **schema-blind** — it cannot know which objects are maps, so `path`
contains literal keys including map keys (e.g. `["users", "alice"]`). Map-ness is
resolved later by the schema-aware `descendSchema`, not by the scanner. (Hence there
is no `inMapKeys` here.)

**`descendSchema(schema, path): Descent`** — walk from `schema.root` resolving each
path segment against the current message:
```ts
type Descent =
  | { kind: "message"; node: MessageNode }
  | { kind: "map"; field: FieldNode }   // enclosing object IS a map; field carries the value type
  | null;
```
Algorithm (handles the map-key hop explicitly):
```
node = messages[root]; i = 0
while i < path.length:
  field = node.fields.find(f => f.json_name === path[i]); if !field: return null
  if field.value_kind === "map":
    if i + 1 >= path.length: return { kind: "map", field }   // directly inside the map object
    if !field.message_type:  return null                     // scalar/enum-valued map → no object to descend
    node = messages[field.message_type]; if !node: return null
    i += 2                                                    // consume the map field AND the arbitrary map key
  else:
    if !field.message_type: return null                      // scalar/enum field → can't descend
    node = messages[field.message_type]; if !node: return null
    i += 1
return { kind: "message", node }
```

**`buildKeySuggestions(schema, ctx): Suggestion[]`** — `d = descendSchema(schema, ctx.path)`;
if `d` is `null` or `{kind:"map"}` (arbitrary keys), return `[]`. Else one suggestion
per field of `d.node`:
- `label = json_name`, `detail = type_label`,
- `kind` from `value_kind` (Field/Struct/Enum/Variable...),
- `insertText` = `"jsonName": <scaffold>` (snippet) — see scaffolds,
- `triggerNext: true` for message/enum fields (sets Monaco
  `command: { id: "editor.action.triggerSuggest" }` so the next level auto-pops).

**`buildValueSuggestions(schema, ctx): Suggestion[]`** — `d = descendSchema(schema, ctx.path)`:
- `d.kind === "message"` → find the field named `ctx.valueField` in `d.node`; if it is
  an enum (`enum_type`), return its `EnumNode.values` as `"VALUE"` string items; if
  bool, return `true`/`false`; else `[]`.
- `d.kind === "map"` → the value type is the map field itself: if `d.field.enum_type`,
  return that enum's values; else `[]`.
- `null` → `[]`.

```ts
type Suggestion = {
  label: string; detail?: string; insertText: string;
  kind: "field" | "message" | "enum" | "scalar" | "value";
  isSnippet?: boolean; triggerNext?: boolean;
};
```

### 5. Value scaffolds (Tier 2), inserted as Monaco snippets

When a **key** is accepted, insert `"jsonName": <scaffold>`:
- `repeated` → `[$0]` (cursor inside; the next completion fills an element),
- else by `value_kind`:
  - message / map → `{\n\t$0\n}`,
  - string / bytes / enum → `"$0"`,
  - number (all int/float/double kinds) → `${1:0}`,
  - bool → `${1:false}`.

**Overwrite guard:** if a value already follows the key (lookahead on the text after
the cursor: next non-whitespace is **not** `,`, `}`, or end-of-line), insert only
`"jsonName"` — never a `: value`.

When an **enum value** is accepted, insert `"VALUE"` over the word range.

### Files

| file | change |
|------|--------|
| `crates/handshaker-core/src/grpc/invoke/schema.rs` | **new** — `MessageSchema` + `build_message_schema_from_pool` + tests |
| `crates/handshaker-core/src/grpc/invoke/mod.rs` | export `build_message_schema_from_pool` |
| `src-tauri/src/ipc/schema.rs` | **new** — `*Ipc` wrappers + `From<core>` |
| `src-tauri/src/commands/grpc.rs` | **new command** `grpc_message_schema` |
| `src-tauri/src/ipc/mod.rs` | declare `pub mod schema;` |
| `src-tauri/src/lib.rs` (builder + specta collect) | register the command: add to `use commands::grpc::{…}` + `collect_commands!` |
| `src/ipc/bindings.ts` | regenerated by specta (`commands.grpcMessageSchema`) |
| `src/ipc/client.ts` | `grpcMessageSchema` Result-unwrapping wrapper + add to the `ipc` object |
| `src/features/workflow/actions.ts` | `fetchMessageSchemaSafe` |
| `src/features/workflow/useMessageSchema.ts` | **new** hook |
| `src/features/bodyview/completion.ts` | **new** — WeakMap, `registerBodyCompletion`, pure fns |
| `src/features/bodyview/completion.test.ts` | **new** — pure-fn tests |
| `src/lib/monaco.ts` | call `registerBodyCompletion(monaco)` in setup |
| `src/features/workflow/CallPanel.tsx` | call `useMessageSchema`, pass `schema` down |
| `src/features/workflow/RequestTabs.tsx` | thread `schema` prop |
| `src/features/invoke/BodyEditor.tsx` | thread `schema` prop |
| `src/features/bodyview/BodyView.tsx` | attach `schema` to model via WeakMap |

---

## Error handling / graceful degradation

- Schema fetch fails (no reflection, server down, method not found) → `null` → no
  completion; the editor is fully usable. No error UI.
- Invalid/partial JSON while typing → `resolveCompletionContext` is best-effort and
  never throws; an unresolved context yields `[]`.
- Recursive/self-referential messages → flat refs + BFS visited-set terminate; no
  depth cap, no infinite loop.
- Inside a map object → keys are user-defined, so key suggestions are suppressed
  (`inMapKeys`); descent into a map-value message still works.
- Unknown `message_type`/`enum_type` ref (should not happen — the closure is
  complete) → `descendSchema`/value lookup returns nothing → `[]`.

## Testing

- **Rust (handshaker-core):** `build_message_schema_from_pool` over a `.proto`
  fixture — scalar (`json_name`/`type_label`), `repeated`, `map<string,int32>`,
  `map<string,Msg>`, enum (values list), nested message, self-referential recursion
  (closure terminates), `oneof_group` populated; plus `MethodNotFound` /
  `ServiceNotFound`.
- **IPC:** light `From<MessageSchema>` field-mapping test.
- **Frontend (Vitest), the bulk:** `resolveCompletionContext` (top-level key, nested
  object key, value-after-`:`, inside string, inside array, unclosed JSON, map
  context); `descendSchema` (root, one level, through a repeated message, through a
  map value, unknown path → null); `buildKeySuggestions` (json_names, detail, scaffold
  per kind, overwrite-guard variant); `buildValueSuggestions` (enum values, bool,
  scalar → empty).
- **Thin Monaco glue + hook:** the provider can be exercised with a fake `model`
  (only `getValueInRange` / `getWordUntilPosition` needed) — optional; primary
  coverage is a live WebView2 pass (as in Group A).
- Full suite green (currently 647) + `tsc` + `build`.

## Non-goals (YAGNI)

- **#3 contract view** — the next, separate spec (will reuse this schema).
- Live validation / diagnostics (Tier 3) — out.
- Completing **map keys** (arbitrary) — out.
- Well-known-type JSON forms (Timestamp→RFC3339 string, Duration, FieldMask,
  wrappers): the schema describes them **structurally** (as message fields), exactly
  as the skeleton does today; special-casing their JSON encoding is out of scope
  (a known limitation inherited from the skeleton).
- Merging the schema into the existing skeleton command (single round-trip) — kept a
  separate command to avoid disturbing the just-stabilized Group A flow.
- Proto comments as `documentation` — reflection data usually lacks `source_code_info`,
  so it is unavailable.

## Edge cases

- **proto3 `optional`** generates a synthetic single-field oneof named `_<field>`.
  Treat such a oneof as "not a real oneof" for `oneof_group` (report `None`), so the
  contract view (#3) doesn't show phantom oneof groups. Completion ignores
  `oneof_group` regardless.
- **`json_name` vs `name`:** the body uses `json_name` (camelCase) to match the
  skeleton (`build_default_json_skeleton` inserts `field.json_name()`). Completion
  suggests `json_name`; `proto_name` is carried only for display.
- **Streaming methods:** schema is built from the input message regardless of
  streaming, consistent with the skeleton (sending is still gated elsewhere).
