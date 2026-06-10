# Method contract view (Group B #3) — design

> **Status:** ✅ Design approved 2026-06-10 (brainstorm) — awaiting implementation plan.
> Branch: `claude/nostalgic-jang-778d08`. Reuses the `grpc_message_schema` flat schema
> shipped by Group B #4 (`docs/superpowers/specs/archive/2026-06-10-body-autocomplete-schema-design.md`).

**Goal:** A convenient on-demand view of a gRPC method's contract (field schema)
while filling in the request body. Two complementary, **independently toggleable**
surfaces:

1. **Inline hints** — grey type annotations after each value in the body editor
   (`"sort": "ASC"  enum SortDir: ASC | DESC`) plus a **ghost skeleton** of missing
   top-level fields, and the same type annotations on the response body;
2. **Contract overlay** — a floating, dismissible panel over the request pane with
   the full browsable request **and** response message contracts (response visible
   *before* sending).

**Decisions locked during brainstorming:**

- Show **both** input and output message contracts.
- Strictly **read-only** reference — no click-to-insert (autocomplete owns insertion).
- Direction: **both** features, with independent toggles (user may want only the
  overlay, or only hints while typing).
- Ghost skeleton: **v1, top-level only** — missing fields of the *root* message;
  nested objects are browsed in the overlay instead.
- Both toggles live in the **Request tab strip** next to the `↺ Reset` button.
  Hints state is a persisted global pref; overlay open-state is ephemeral per panel.

**Tech stack:** Rust / `prost-reflect` 0.16 (core) · Tauri + specta (IPC) · React +
`@monaco-editor/react` (frontend) · Vitest + RTL + Rust unit tests.

---

## Backend — `side` parameter on the existing schema endpoint

The shipped endpoint builds the schema from the method's **input** message only.
The contract view needs the **output** side too. No new endpoint — one parameter.

### Core — `crates/handshaker-core/src/grpc/invoke/schema.rs`

```rust
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MessageSide { Input, Output }

pub fn build_message_schema_from_pool(
    pool: &DescriptorPool,
    service: &str,
    method: &str,
    side: MessageSide,                 // NEW — picks m.input() / m.output() as root
) -> Result<MessageSchema, CoreError>
```

Everything else (BFS closure, flat full-name refs, `type_label` construction,
recursion safety, proto3-optional filtering) is untouched — the builder already
works from an arbitrary root message.

### IPC — `src-tauri/src/ipc/schema.rs` + `src-tauri/src/commands/grpc.rs`

`MessageSideIpc` (`"input" | "output"`, specta enum) with `Into<MessageSide>`.
The command gains a **required** `side: MessageSideIpc` parameter (same cache
discipline: contract-cache hit → build from pool; miss → `activate` first).
`src/ipc/bindings.ts` is regenerated and committed (convention: never hand-edit).
The single existing frontend call site is updated to pass `side: "input"`.

---

## Frontend

### 1. Fetch both sides

- `fetchMessageSchemaSafe(target, service, method, side)` in
  `src/features/workflow/actions.ts` — passes `side` through; still returns `null`
  on any error (graceful degradation).
- `useMessageSchema(target, side)` — cache key extends to
  `address|tls|service|method|side` (process-wide `Map`, nulls cached too).
- `CallPanel` fetches **both sides eagerly**:
  `inputSchema = useMessageSchema(t, "input")`, `outputSchema = useMessageSchema(t, "output")`.
  The input fetch warms the contract cache (may `activate` over the network); the
  output fetch right after it is a cheap local IPC call against the warmed pool.
  Eager fetch ⇒ no loading states inside the overlay or the hint providers.

### 2. Inlay type hints — `src/features/bodyview/hints.ts` (new)

Pure core, mirroring the completion architecture:

- **`computeInlayHints(text: string, schema: MessageSchemaIpc): HintSpec[]`** —
  walks the body's parsed tree (reuse the tolerant `jsonTree`/`spans` parsing used
  by elision/copy) and, for every recognized key at any depth, resolves its field
  via `descendSchema` (from `completion.ts`). One hint per field occurrence:
  `{ line, column, label }`, anchored immediately **after the value's first token**
  on the key's line (after the opening `{`/`[` for composite values).
  Labels come straight from the schema: `type_label` as-is, plus enum expansion
  `enum SortDir: ASC | DESC` (first **5** values joined with ` | `, then `| …`
  when more exist; the full list is always visible in the overlay tree).
- **`registerBodyInlayHints(monaco)`** — registered once in `src/lib/monaco.ts`
  alongside `registerBodyCompletion`, on the `json-with-vars` language. Reads the
  model's schema from the shared `schemaByModel` WeakMap; no schema → no hints.
  Signals `onDidChangeInlayHints` when a model's schema is (re)attached, covering
  the programmatic-update gotcha (monaco#4700, e.g. Reset-to-template via
  `executeEdits`).
- **Response side:** `ResponsePanel` threads `outputSchema` into its `BodyView`;
  the response model gets a `schemaByModel` entry too. This deliberately relaxes
  Group B #4's "response model has no schema entry" stance: that isolation guarded
  *completions*, which remain suppressed by `readOnly` — hints are wanted here.
- **Toggle:** the standard editor option — `updateOptions({ inlayHints: { enabled:
  "on" | "off" } })` from the pref (below). The provider stays registered; no
  re-registration churn.

### 3. Ghost skeleton (top-level) — `src/features/bodyview/ghost.ts` (new)

- **`computeGhostLines(text: string, schema: MessageSchemaIpc):
  { afterLine: number; lines: string[] } | null`** — pure: collects the root
  message's fields minus the keys present at depth 1; renders lines like
  `"createdAfter": Timestamp` (json_name + type_label). Anchor: the line of the
  last top-level entry (or the opening `{` when the body is empty/`{}`), i.e. the
  zone sits just above the root's closing `}`. Root braces unparseable → `null`.
  All fields present → `null`.
- **Rendering:** one Monaco **view zone** (`editor.changeViewZones`) owned by
  `BodyView`, request mode only: grey italic non-editable lines,
  `suppressMouseDown`, `heightInLines = lines.length`. Recomputed debounced
  (~150 ms) on `onDidChangeModelContent` and on schema change; zone removed when
  the result is `null` or hints are toggled off. This is the same mechanism Monaco
  itself uses for multi-line ghost text (decoration + view zone, monaco#4491).
- Ghost lines and inlay hints share **one** toggle — they are one feature
  ("hints") from the user's perspective.

### 4. Contract overlay — `src/features/contract/` (new feature dir)

- **`ContractPanel.tsx`** — floating container: absolutely positioned top-right
  inside the request pane (the pane wrapper in `CallPanel` becomes `relative`),
  width ~320 px, max-height with internal scroll, above the editor (but below
  Monaco's own widgets — the suggest widget may legitimately cover it).
  Header: method name + ✕. Tabs **Request | Response** (`UnderlineTabs` reuse).
  Body: `ContractTree` over the corresponding schema; `null` schema → placeholder
  "Контракт недоступен" with a short hint (reflection off / server unreachable).
  Dismissal: ✕, the tab-strip toggle, or Esc (window `keydown` listener that skips
  `defaultPrevented` events, so Monaco's own Esc handling — closing the suggest
  widget — wins). **No click-outside dismissal** — the core scenario is typing in
  the editor while the panel stays open.
- **`ContractTree.tsx`** — recursive tree over `MessageSchemaIpc`: one row per
  field — `json_name` (primary, matches the body; `proto_name` in a tooltip),
  right-aligned `type_label`, enum values inline (`ASC | DESC`), oneof members
  grouped under a `oneof <name>` badge, expand chevron for message-typed fields
  (incl. repeated messages and map value-messages) resolving via the
  `messages`-by-full-name map. A visited-set along the expansion path stops
  recursive types: the row renders un-expandable with an `↻ recursive` note.
- **`tree.ts`** — the pure expansion/derivation logic (rows from a `MessageNode`,
  oneof grouping, visited-set), unit-tested without React.

### 5. Toggles — `RequestTabs.tsx` + `use-prefs.ts`

- Two ghost `icon-xs` buttons next to `↺` (visible on the Request tab, like `↺`):
  - **hints** — reads/writes the new pref `bodyHints: boolean` (default **true**)
    via `usePrefs` directly; active state = accent foreground, `aria-pressed`.
  - **contract** — controlled from `CallPanel` (`contractOpen` / `onToggleContract`
    props); ephemeral `useState`, default closed, dies with the panel (no leak
    across workflow tabs).
- `bodyHints` joins `Prefs` in `src/lib/use-prefs.ts` (localStorage broadcast —
  every open editor reacts immediately).

### Data flow

```
CallPanel
├─ useMessageSchema(t, "input")  ─► RequestTabs ─► BodyEditor ─► setModelSchema(model, input)
│                                                                ├─ completion (existing)
│                                                                ├─ inlay hints (new)
│                                                                └─ ghost view zone (new)
├─ useMessageSchema(t, "output") ─► ResponsePanel ─► BodyView ─► setModelSchema(model, output)
│                                                                └─ inlay hints on response
└─ both ─► ContractPanel (tabs Request | Response)

prefs.bodyHints ─► BodyView: updateOptions({inlayHints}) + ghost zone visibility
CallPanel.contractOpen ─► ContractPanel mount/unmount + toggle button state
```

Method change ⇒ hook keys change ⇒ both schemas refetch (or hit cache) ⇒ hints /
ghost / panel re-derive. The send flow is untouched.

### Files

| file | change |
|------|--------|
| `crates/handshaker-core/src/grpc/invoke/schema.rs` | `MessageSide` enum + `side` param + tests |
| `crates/handshaker-core/src/grpc/invoke/mod.rs` | export `MessageSide` |
| `src-tauri/src/ipc/schema.rs` | `MessageSideIpc` + `Into<core>` |
| `src-tauri/src/commands/grpc.rs` | `side` param on `grpc_message_schema` |
| `src/ipc/bindings.ts` | regenerated by specta |
| `src/ipc/client.ts` | wrapper passes `side` |
| `src/features/workflow/actions.ts` | `fetchMessageSchemaSafe(side)` |
| `src/features/workflow/useMessageSchema.ts` | `side` in signature + cache key |
| `src/features/workflow/CallPanel.tsx` | fetch both sides; `contractOpen` state; render `ContractPanel`; thread `outputSchema` |
| `src/features/workflow/RequestTabs.tsx` | two toggle buttons (hints pref, contract props) |
| `src/features/workflow/ResponsePanel.tsx` | thread `outputSchema` → response `BodyView` |
| `src/features/invoke/BodyEditor.tsx` | no API change (schema already threaded) |
| `src/features/bodyview/BodyView.tsx` | response-mode schema attach; `inlayHints` option from pref; ghost zone lifecycle |
| `src/features/bodyview/hints.ts` / `.test.ts` | **new** — pure hint computation + provider |
| `src/features/bodyview/ghost.ts` / `.test.ts` | **new** — pure ghost computation |
| `src/lib/monaco.ts` | `registerBodyInlayHints(monaco)` |
| `src/lib/use-prefs.ts` | `bodyHints` pref (default `true`) |
| `src/features/contract/ContractPanel.tsx` / `.test.tsx` | **new** — floating panel |
| `src/features/contract/ContractTree.tsx` (+ tests) | **new** — schema tree |
| `src/features/contract/tree.ts` / `.test.ts` | **new** — pure expansion logic |

---

## Error handling / graceful degradation

Everything is best-effort, like autocomplete — this is a reference feature, never
an error surface (no toasts).

- **Schema unavailable** (`null`: reflection off, server down, no method selected)
  → hints and ghost simply don't appear (provider returns empty); the overlay
  opens with the "Контракт недоступен" placeholder.
- **Invalid / partial JSON** → the tolerant parser annotates the keys it
  recognizes; the ghost zone hides when the root's closing brace can't be found.
- **Recursive types** → schema is flat and recursion-safe by design (Group B #4);
  the tree's visited-set stops expansion with an `↻ recursive` marker; hint
  resolution is path-driven and terminates naturally.
- **Map fields** → hint/tree label is the server-built `type_label`
  (`map<string, int64>`); no per-entry descent for hints (consistent with
  completion); the tree can expand into a map's value-message.
- **Programmatic body updates** (Reset-to-template, method switch) →
  `onDidChangeInlayHints` + content-change recompute keep hints/ghost in sync
  (monaco#4700 gotcha).
- **Elided response bodies** (>4096 elision) → hints attach only to keys present
  in the *rendered* text; elided subtrees get none. Acceptable degradation.

## Testing

- **Rust (`schema.rs`):** existing hand-built-pool harness — `side: Input` vs
  `side: Output` roots; `ServiceNotFound`/`MethodNotFound` unchanged.
- **Pure cores (vitest):**
  - `hints.ts` — types at all depths; repeated/enum/map labels; enum-list
    truncation; broken JSON tolerance; empty schema → `[]`;
  - `ghost.ts` — full body → `null`; partial → only missing fields; anchor line;
    empty body/`{}`; broken root → `null`;
  - `contract/tree.ts` — expansion by full-name; visited-set on a recursive type;
    oneof grouping; enum values.
- **Components (vitest + RTL):** `ContractPanel` (tabs, placeholder, ✕/Esc);
  `RequestTabs` (both buttons: `aria-pressed`, pref write, Request-tab-only
  visibility); `CallPanel` integration (open/close, both schemas threaded);
  `useMessageSchema` `side`-keyed cache.
- **Monaco glue:** via the existing `editorLike` harness — view-zone add/remove on
  content change; `updateOptions` reaction to the pref. The inlay provider itself
  unit-tested with a fake model (as the completion provider is).
- **Final gate:** `pnpm lint` + full vitest suite + `cargo test` + `pnpm build`,
  then a live WebView2 pass (hints while typing; ghost after deleting a field;
  panel open while the suggest widget is up — no fights).

## Non-goals (YAGNI)

- Click-to-insert from the tree into the body (read-only is locked).
- Ghost skeleton below the top level (overlay covers nested shapes).
- Special streaming presentation — client/server-streaming methods show their
  input/output message contracts as-is.
- A standalone browser of arbitrary proto types outside a method (future feature
  over the same schema if ever needed).
- Persisting the overlay's open-state / tab across sessions.
- Proto comments/documentation in the tree (reflection lacks `source_code_info`).

## Edge cases

- **proto3 `optional`** — synthetic oneofs are already reported as
  `oneof_group: None` by the backend (Group B #4); the tree shows no phantom
  groups.
- **`json_name` everywhere user-facing** — tree rows and ghost lines use
  `json_name` (matches the body and the skeleton); `proto_name` only in tooltips.
- **Minified / single-line JSON** — hint anchoring is token-based (after the
  value's first token), not line-based, so multiple pairs on one line each get
  their own hint.
- **Empty method (no fields)** — ghost: `null` (nothing missing); tree: an empty
  state row ("no fields"); hints: none.
- **Window resize / pane resize** — the overlay is anchored to the pane's corner
  (CSS), no JS measurement; Monaco view zones relayout natively.

## Sources

- Monaco `IViewZone` / `changeViewZones`: <https://microsoft.github.io/monaco-editor/typedoc/interfaces/editor.IViewZone.html>
- Monaco renders multi-line ghost text as decoration + view zone: <https://github.com/microsoft/monaco-editor/issues/4491>
- `registerInlayHintsProvider`: <https://microsoft.github.io/monaco-editor/typedoc/functions/languages.registerInlayHintsProvider.html>
- Inlay-hint duplication on programmatic updates: <https://github.com/microsoft/monaco-editor/issues/4700>
