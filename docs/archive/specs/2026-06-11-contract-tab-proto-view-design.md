# Contract tab — proto-source view in the Response panel — design

> **Status:** ✅ Design approved 2026-06-11 (brainstorm, mockup variant A chosen).
> Branch: `claude/nostalgic-jang-778d08`. **Supersedes the "Contract overlay"
> section** of `2026-06-10-contract-view-design.md`: the floating `ContractPanel`
> shipped by that spec is judged inconvenient in live use and is **removed** in
> favor of a Contract tab in the Response panel. Inline hints / ghost skeleton /
> completion / diagnostics from that spec are untouched.

**Goal:** The full method contract lives in a fourth tab of the Response panel
(`Body · Trailers · Headers · Contract`), rendered as a **syntax-highlighted
proto-source listing** — authentic `message`/`enum`/`oneof` blocks with field
numbers, exactly one printed block per reachable type (recursion-safe by
construction). Inside the tab: a compact **Request | Response** segmented switch
(both sides browsable before sending) and the method name.

**Decisions locked during brainstorming:**

- Visual style: **variant A — proto-source** (mockups also explored a badge tree
  and a JSON-skeleton; JSON-skeleton noted as a possible future alternate view).
- The overlay (`ContractPanel`/`ContractTree`/`tree.ts`) and its `ListTree`
  toggle in the Request tab strip are **deleted**. The hints toggle and `↺`
  Reset stay.
- Contract tab exists **only on the editable draft panel** — history panels keep
  three tabs (no schema is fetched for them today; unchanged).
- **Default tab = Contract** while no response has arrived and a schema is
  available; the arrival of a response **auto-switches to Body** if the user is
  on Contract (a manual tab choice before that wins — no surprise flips).
- Field numbers (`= 1;`), `optional`, and enum value numbers (`ACTIVE = 0;`)
  require a **small backend extension** — approved.

**Tech stack:** Rust / `prost-reflect` 0.16 (core) · Tauri + specta (IPC) ·
React (frontend) · Vitest + RTL + Rust unit tests.

---

## Backend — three additive schema fields

The flat `MessageSchema` (BFS closure, full-name refs) already carries almost
everything; the proto view needs numbers and `optional`.

### Core — `crates/handshaker-core/src/grpc/invoke/schema.rs`

```rust
pub struct FieldNode {
    // ... existing ...
    /// Proto field number (`= N;` in the contract view).
    pub number: u32,                  // NEW — FieldDescriptor::number()
    /// proto3 `optional` (detected as the synthetic single-field `_name` oneof).
    pub optional: bool,               // NEW — same check real_oneof_name() does
}

pub struct EnumValueNode { pub name: String, pub number: i32 }  // NEW

pub struct EnumNode {
    pub full_name: String,
    pub values: Vec<EnumValueNode>,   // CHANGED — was Vec<String>
}
```

`real_oneof_name` already computes the synthetic-oneof predicate and throws it
away; it is refactored so `build_field` gets both the real oneof name **and**
the `optional` flag from one check. BFS order is untouched (root message first —
the view relies on it).

### IPC — `src-tauri/src/ipc/schema.rs`

`FieldNodeIpc` gains `number: u32`, `optional: bool`; new `EnumValueIpc { name,
number }`; `EnumNodeIpc.values: Vec<EnumValueIpc>`. `src/ipc/bindings.ts` is
regenerated and committed (never hand-edited). Existing frontend consumers of
`EnumNodeIpc.values` switch to `.name` mechanically:

- `src/features/bodyview/completion.ts` — enum value suggestions,
- `src/features/bodyview/hints.ts` — enum preview in hint labels
  (+ their tests).

---

## Frontend

### 1. Pure renderer — `src/features/contract/proto.ts` (new)

**`renderProtoDoc(schema: MessageSchemaIpc): ProtoDoc`** — pure, fully
unit-testable. A `ProtoDoc` is a list of **blocks** (one per printed type, keyed
by `full_name`) of **lines** of **tokens**:

```ts
type ProtoToken =
  | { kind: "keyword"; text: string }            // message enum oneof repeated optional map
  | { kind: "scalar"; text: string }             // string int32 …
  | { kind: "typeRef"; text: string; target: string; tooltip: string }  // clickable; tooltip = full name
  | { kind: "name"; text: string; tooltip?: string }  // type/field names; field tooltip = json_name
  | { kind: "punct"; text: string };             // braces, `= 1;`, indentation
```

Rendering rules:

- **Order:** root message first, remaining messages in schema (BFS) order, then
  enums in discovery order. One block per type — recursion needs no special
  handling (named references, never inlined).
- **Type names:** short last segment with the full name in a tooltip; if a short
  name collides across the printed document (messages + enums), the **full name
  is printed** for all colliding types and their refs.
- **Fields:** declaration order, `[optional |repeated ]<Type> <proto_name> = <N>;`.
  Map fields print `map<key, Value> name = N;` — the key label is recovered from
  our own `type_label` format (`map<…, …>`), the value becomes a `typeRef` when
  `message_type`/`enum_type` is set.
- **oneof:** consecutive fields sharing `oneof_group` fold into a
  `oneof <name> { … }` block (descriptor order keeps source-contiguous oneofs
  contiguous; a non-contiguous run would just open a second block).
- **Enums:** multi-line, `<NAME> = <number>;` per value.
- **Empty message** prints `message X {}` on one line.

### 2. Components — `src/features/contract/`

- **`ProtoView.tsx`** (new) — renders a `ProtoDoc` in the editor's mono font.
  Token colors come from the app theme: keywords + punctuation/numbers muted,
  scalars one accent, `typeRef`s a second accent with hover underline. Each
  block is a DOM node keyed by `full_name`; clicking a `typeRef` scrolls its
  block into view (`scrollIntoView`, smooth unless `prefers-reduced-motion`)
  and flash-highlights it briefly (motion-token CSS, reduced-motion safe).
- **`ContractView.tsx`** (new) — the tab's content: a slim header row with the
  **Request | Response** segmented switch (two `aria-pressed` ghost buttons in
  a bordered group) and the method name right-aligned; below, `ProtoView` over
  the selected side's schema, or graceful placeholders — no method selected →
  "выбери метод", schema `null` → the existing "Контракт недоступен" text
  (reflection off / server unreachable).
- **Deleted:** `ContractPanel.tsx`, `ContractTree.tsx`, `tree.ts` and their
  tests — the overlay, its Esc handling, and the row-derivation logic die with
  this spec.

### 3. Response panel integration — `src/features/response/ResponsePanel.tsx`

```ts
export interface ResponsePanelProps {
  // ... existing ...
  /** Editable draft only: enables the Contract tab. Omit/null → three tabs. */
  contract?: { input: MessageSchemaIpc | null; output: MessageSchemaIpc | null;
               method: string } | null;
}
```

- Tab strip gains `{ value: "contract", label: "Contract" }` when `contract` is
  set. The **side** state (`request | response`) lives in `ResponsePanel` so it
  survives tab switches (tab content is conditionally rendered).
- **Default-tab logic:** a `userPickedTab` ref is set by any manual tab click.
  While `state === "idle"`, no outcome, at least one side's schema present and
  the user hasn't picked — an effect selects `contract`. On transition into
  `success`/`error` (a response just arrived) with the tab on `contract` **and
  `userPickedTab` unset** — switch to `body` (the response wins focus). After a
  manual pick the user owns the tab: an explicitly chosen Contract stays put
  across Sends.
- The `EmptyState` ("Awaiting first call") remains for the Body tab and for
  panels without `contract`.

### 4. Call panel wiring — `src/features/workflow/`

- `CallPanel.tsx`: drop `contractOpen` state and the `<ContractPanel …>` render;
  pass `contract={editable ? { input: schema, output: outputSchema, method:
  step.method } : null}` through `ResponseSlot` to `ResponsePanel`. Both schemas
  are already fetched eagerly — no new IPC traffic.
- `RequestTabs.tsx`: remove the `ListTree` button and the
  `contractOpen`/`onToggleContract` props (hints toggle and `↺` stay).

### Data flow

```
CallPanel
├─ useMessageSchema(t, "input")  ─► RequestTabs ─► BodyEditor (completion/ghost/markers — unchanged)
├─ useMessageSchema(t, "output") ─► ResponseSlot ─► ResponsePanel ─► response BodyView hints (unchanged)
└─ both + step.method ──────────────► ResponsePanel.contract ─► ContractView ─► ProtoView
                                         tabs: Body · Trailers · Headers · Contract
                                         side: Request | Response (panel-local state)
```

### Files

| file | change |
|------|--------|
| `crates/handshaker-core/src/grpc/invoke/schema.rs` | `number`/`optional` on `FieldNode`, `EnumValueNode`, refactored oneof check + tests |
| `src-tauri/src/ipc/schema.rs` | mirror IPC structs |
| `src/ipc/bindings.ts` | regenerated by specta |
| `src/features/bodyview/completion.ts` (+tests) | enum values → `.name` |
| `src/features/bodyview/hints.ts` (+tests) | enum preview → `.name` |
| `src/features/contract/proto.ts` / `.test.ts` | **new** — pure ProtoDoc renderer |
| `src/features/contract/ProtoView.tsx` / `.test.tsx` | **new** — token colors, click-to-scroll, flash |
| `src/features/contract/ContractView.tsx` / `.test.tsx` | **new** — side switch + placeholders |
| `src/features/contract/ContractPanel.tsx`, `ContractTree.tsx`, `tree.ts` (+tests) | **deleted** |
| `src/features/response/ResponsePanel.tsx` (+tests) | `contract` prop, 4th tab, default/auto-switch logic |
| `src/features/workflow/CallPanel.tsx` (+tests) | overlay state removed; `contract` threaded |
| `src/features/workflow/RequestTabs.tsx` (+tests) | `ListTree` button + props removed |
| `docs/superpowers/plans/2026-06-10-contract-view.md` | note: overlay live-check items superseded by this spec |

---

## Error handling / graceful degradation

Reference feature, never an error surface (no toasts) — same stance as hints.

- **No method selected** → Contract tab shows "выбери метод" hint; default-tab
  logic does not fire (no schemas).
- **Schema `null`** (reflection off / server down) → "Контракт недоступен"
  placeholder per side; the other side may still render.
- **Method change while idle** → schemas refetch (or hit cache), the view
  re-renders in place; tab/side selection is preserved.
- **History panels** → no `contract` prop, three tabs, zero behavior change.

## Testing

- **Rust (`schema.rs`):** field `number` round-trips; `optional` true for
  proto3-optional and false for plain/real-oneof fields; enum values carry
  numbers; existing tests updated for the `values` shape.
- **`proto.ts` (vitest):** root-first block order; field line shape incl.
  `repeated`/`optional`/map; oneof folding (and a non-contiguous run opening a
  second block); enum block; short-name collision → full names; empty message;
  typeRef targets resolve to printed blocks.
- **Components (RTL):** `ProtoView` — token classes, click on a ref scrolls
  (mock `scrollIntoView`) + flash class; `ContractView` — side switch
  `aria-pressed`, placeholders; `ResponsePanel` — 4th tab only with `contract`,
  default tab Contract pre-send, auto-switch to Body on response, manual choice
  wins, side survives tab switches; `RequestTabs`/`CallPanel` — overlay gone.
- **Final gate:** `pnpm lint` + vitest + `cargo test -p handshaker-core` +
  `cargo test -p handshaker` + `pnpm build`, then a live WebView2 pass
  (Ctrl+R; contract pre-send, side switch, click-to-scroll, auto-switch on
  Send, history panels untouched).

## Non-goals (YAGNI)

- JSON-skeleton alternate view (mockup variant C) — possible future toggle.
- `rpc` signature line / streaming flags in the listing (the tab shows message
  contracts; streaming markers live in the method picker).
- Copy-as-proto button (plain text is selectable as-is).
- Search/filter inside the contract.
- Persisting tab/side selection across sessions.
- Proto comments/docs (reflection lacks `source_code_info`).
- proto2 nuances (`required`, groups) — proto3 assumed, as everywhere else.

## Edge cases

- **Recursive types** — named references only, each type printed once; a
  self-link is just a clickable ref to the already-visible block.
- **Short-name collisions** (`a.Filter` + `b.Filter`) — both printed with full
  names; refs follow suit.
- **Huge contracts** — one scrollable listing; blocks are plain DOM (no
  virtualization — contracts are small relative to e.g. response bodies).
- **`json_name` vs `proto_name`** — the proto view deliberately shows
  `proto_name` (authentic source); the JSON-facing surfaces (ghost, completion,
  hints, diagnostics) keep `json_name`. Tooltip on a field name shows its
  `json_name` to bridge the two.
