# Contract Tab — Proto-Source View Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task.
> Steps use checkbox (`- [ ]`) syntax for tracking.

> **Status:** 🚧 code-complete — awaiting live WebView2 verification (Task 8
> Step 5 checklist + Step 6 finish). Phase A done 2026-06-11 (Task 1:
> `f30797d`+`69f3b6b`, Task 2: `193715b`+`cb08bc4`). Phase B done 2026-06-11
> (Task 3: `7ae82bc`+`427737a`, Task 4: `96b8bca`+`8edcbd8`, Task 5: `3f925c1`).
> Phase C done 2026-06-12 (Task 6: `97ab7ea`, Task 7: `34b1a48`+`03da8da`;
> все прошли spec+quality ревью). Full gate 2026-06-12: tsc clean ·
> vitest 756 (111 файлов) · cargo handshaker-core + handshaker зелёные ·
> `pnpm build` ок. NB: `pnpm lint` в этом репо — только `tsc -b`, eslint нет.
> Branch `claude/nostalgic-jang-778d08` (existing feature worktree).
> Финальное ревью ветки 2026-06-12: пройдено; найденный блокер «main ушёл
> вперёд на 30 коммитов (env-фичи + v0.1.14), ff невозможен» закрыт
> merge-коммитом `a5849a6` (main → ветка; конфликт CLAUDE.md разрешён,
> `bindings.ts` перегенерирован и совпал с авто-мерджем побайтово; гейт на
> смердженном дереве: tsc clean · vitest 787 · cargo core 139 + app 45 ·
> build ок). `main` снова ancestor HEAD — ff-merge возможен. Live-чеклист
> Step 5 пополнен заметками ревью: flash «Awaiting first call» при маунте,
> «Контракт недоступен» мелькает во время фетча схемы (null = и loading, и
> unavailable), re-arm `userPickedTab` при смене метода.
> **Spec:** `docs/superpowers/specs/2026-06-11-contract-tab-proto-view-design.md` (approved 2026-06-11).
> Supersedes the floating-overlay part of the contract-view feature
> (`docs/superpowers/plans/2026-06-10-contract-view.md`, Phases A–E shipped).

**Goal:** Replace the floating `ContractPanel` overlay with a Contract tab in the
Response panel that renders the method contract as a syntax-highlighted
proto-source listing (field numbers, `optional`, enum value numbers).

**Architecture:** A small additive backend extension (`FieldNode.number/optional`,
`EnumValueNode`) flows through the IPC mirror into regenerated bindings. A pure
`renderProtoDoc` core turns the flat `MessageSchemaIpc` into token lines;
`ProtoView` colors tokens and handles click-to-scroll; `ContractView` adds the
Request|Response side switch; `ResponsePanel` hosts the fourth tab with
default-tab and auto-switch-on-response logic. The overlay is deleted first.

**Tech Stack:** Rust (`prost-reflect` 0.14) · Tauri + specta · React 18 ·
Vitest + RTL · Cargo tests.

**Gate commands (used throughout):**
- `pnpm lint` (tsc -b + eslint) · `pnpm test` (vitest) · `pnpm build`
- `cargo test -p handshaker-core` · `cargo test -p handshaker`
- Regenerate bindings: `cargo run -p handshaker --bin export-bindings --features export-bindings`
  (needs `dist/` present — run `pnpm build` first on a fresh worktree)
- All git commands: `git -C <worktree>`; verify `git branch --show-current` =
  `claude/nostalgic-jang-778d08` before every commit.

---

## Phase A — clear the ground (Tasks 1–2)

### Task 1: Remove the floating contract overlay

The tab replaces the overlay; deleting first avoids patching soon-dead tests in
Task 2. After this task the app temporarily has no contract view — acceptable
mid-branch, the suite stays green.

**Files:**
- Delete: `src/features/contract/ContractPanel.tsx`, `src/features/contract/ContractPanel.test.tsx`
- Delete: `src/features/contract/ContractTree.tsx`, `src/features/contract/ContractTree.test.tsx`
- Delete: `src/features/contract/tree.ts`, `src/features/contract/tree.test.ts`
- Modify: `src/features/workflow/RequestTabs.tsx`
- Modify: `src/features/workflow/CallPanel.tsx`
- Modify: `src/features/workflow/RequestTabs.test.tsx`
- Modify: `src/features/workflow/CallPanel.editable.test.tsx`
- Modify: `docs/superpowers/plans/2026-06-10-contract-view.md`

- [x] **Step 1: Delete the six overlay files**

```powershell
git -C . rm src/features/contract/ContractPanel.tsx src/features/contract/ContractPanel.test.tsx src/features/contract/ContractTree.tsx src/features/contract/ContractTree.test.tsx src/features/contract/tree.ts src/features/contract/tree.test.ts
```

(`src/features/contract/` stays — Tasks 3–5 repopulate it.)

- [x] **Step 2: Strip the toggle from `RequestTabs.tsx`**

Remove `ListTree` from the lucide import (line 2), the two props from
`RequestTabsProps` and the destructuring (lines 25–28, 30):

```ts
  /** Contract overlay toggle (editable draft only). Omit to hide the button. */
  contractOpen?: boolean;
  onToggleContract?: () => void;
```

and the whole `{onToggleContract ? (<Tooltip content="Method contract">…</Tooltip>) : null}`
button block (lines 59–73). The hints toggle and `↺ Reset` button stay untouched.

- [x] **Step 3: Strip the overlay from `CallPanel.tsx`**

Remove the `ContractPanel` import, the state line
`const [contractOpen, setContractOpen] = useState(false);` (line 89, keep the
schema fetches below it), and replace the request-panel contents (lines 137–158)
— the `relative` wrapper existed only to anchor the overlay:

```tsx
        <ResizablePanel id="request" minSize="20%">
          <RequestTabs
            step={step}
            serviceAuth={step.auth}
            onBody={onBody}
            onMetadata={onMetadata}
            onSubmit={() => sendShortcutRef.current()}
            onResetTemplate={editable ? onResetBody : undefined}
            schema={schema}
          />
        </ResizablePanel>
```

If `useState` becomes unused in the React import, drop it (lint will flag it).
`outputSchema` stays — `ResponseSlot` uses it, and Task 7 reuses it for the tab.

- [x] **Step 4: Update the tests that referenced the overlay**

- `RequestTabs.test.tsx`, describe `"RequestTabs contract toggles"` (line 116):
  - delete `it("shows the contract button only when onToggleContract is provided, and reports pressed state")` (lines 128–140);
  - delete `it("disables the contract button when no method is selected")` (lines 150–156);
  - in `it("hides both toggles off the Request tab")` (lines 142–148): drop the
    `onToggleContract={vi.fn()}` prop and the
    `expect(screen.queryByRole("button", { name: /method contract/i })).toBeNull();`
    assertion, rename the `it` to `"hides the hints toggle off the Request tab"`;
  - rename the describe to `"RequestTabs hints toggle"` (it keeps the
    bodyHints-pref test and the renamed visibility test).
- `CallPanel.editable.test.tsx`: delete `describe("CallPanel contract overlay", …)`
  (lines 84–108 — both `it`s) and reword the comment on lines 15–16 to
  `// No reflection in tests: both schema sides resolve null.`

- [x] **Step 5: Run the suite**

Run: `pnpm lint; if ($?) { pnpm test }`
Expected: lint clean; all tests pass (count drops vs. 752 — overlay tests removed).

- [x] **Step 6: Mark the old plan's overlay checklist superseded**

In `docs/superpowers/plans/2026-06-10-contract-view.md`, directly under the
Task 14 Step 2 heading add:

```markdown
> ⚠️ 2026-06-11: пункты про overlay-панель (Toggle/вкладки/Esc/печать-не-закрывает)
> superseded — оверлей заменён табом Contract в Response-панели, см.
> `docs/superpowers/specs/2026-06-11-contract-tab-proto-view-design.md` и план
> `2026-06-11-contract-tab-proto-view.md`. Остальные пункты (хинты, ghost,
> автокомплит, ↺, response-хинты) остаются в силе.
```

- [x] **Step 7: Commit**

```powershell
git -C . add -A
git -C . commit -m "refactor(contract): remove floating overlay (superseded by Response-panel tab)"
```

> ✅ 2026-06-11: done — commits `f30797d` (removal, 732 FE tests green) +
> `69f3b6b` (review follow-up: stale overlay references in comments).

Append the standard trailer: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.

### Task 2: Schema data extension end-to-end (core → IPC → bindings → TS)

One atomic task: splitting it would leave the workspace uncompilable between
commits (`src-tauri`'s `From<EnumNode>` breaks the moment core's `values`
changes shape).

**Files:**
- Modify: `crates/handshaker-core/src/grpc/invoke/schema.rs`
- Modify: `crates/handshaker-core/src/grpc/invoke/mod.rs:15-18` (re-export)
- Modify: `crates/handshaker-core/src/grpc/mod.rs:25-29` (re-export)
- Modify: `src-tauri/src/ipc/schema.rs`
- Regenerate: `src/ipc/bindings.ts`
- Modify: `src/features/bodyview/completion.ts:333-341`
- Modify: `src/features/bodyview/hints.ts:18-20`
- Modify test factories: `src/features/bodyview/completion.test.ts`,
  `hints.test.ts`, `ghost.test.ts`, `validate.test.ts`

- [x] **Step 1: Write the failing core tests**

In `schema.rs` tests: update the enum assertion and add a numbers/optional test.

```rust
    // in enum_field_records_enum_node_with_values — replace the last assertion:
    assert_eq!(
        en.values,
        vec![
            EnumValueNode { name: "UNKNOWN".into(), number: 0 },
            EnumValueNode { name: "ACTIVE".into(), number: 1 },
        ]
    );

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
```

- [x] **Step 2: Run core tests to verify they fail**

Run: `cargo test -p handshaker-core`
Expected: compile error — `EnumValueNode` not found / no field `number`.

- [x] **Step 3: Implement the core extension**

In `schema.rs`:

```rust
#[derive(Debug, Clone, PartialEq)]
pub struct FieldNode {
    // ... existing fields unchanged ...
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
```

Replace `real_oneof_name` with a combined helper (same predicate, nothing thrown
away anymore):

```rust
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
```

In `build_field`: `let (oneof_group, optional) = oneof_info(field);` replaces the
`real_oneof_name` call; both `FieldNode { … }` literals (map arm and the normal
arm) gain `number: field.number(), optional,`. In `record_enum`:

```rust
            values: e
                .values()
                .map(|v| EnumValueNode { name: v.name().to_string(), number: v.number() })
                .collect(),
```

Re-exports: add `EnumValueNode` to `pub use schema::{…}` in
`crates/handshaker-core/src/grpc/invoke/mod.rs` and to the `pub use invoke::{…}`
list in `crates/handshaker-core/src/grpc/mod.rs`.

- [x] **Step 4: Run core tests to verify they pass**

Run: `cargo test -p handshaker-core`
Expected: PASS (all schema tests incl. the new one).

- [x] **Step 5: Mirror in the IPC layer**

`src-tauri/src/ipc/schema.rs` — extend the import to include `EnumValueNode`,
then:

```rust
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
```

`From<FieldNode>` gains `number: f.number, optional: f.optional,`; add

```rust
impl From<EnumValueNode> for EnumValueIpc {
    fn from(v: EnumValueNode) -> Self {
        Self { name: v.name, number: v.number }
    }
}
```

and `From<EnumNode>` becomes `values: e.values.into_iter().map(Into::into).collect()`.
Update the module's `from_core_maps_fields` test: the `FieldNode` literal gains
`number: 1, optional: false,`; the `EnumNode` literal becomes
`values: vec![EnumValueNode { name: "A".into(), number: 0 }]`; the final
assertion becomes `assert_eq!(ipc.enums[0].values[0].name, "A");`.

- [x] **Step 6: Run src-tauri tests**

Run: `cargo test -p handshaker`
Expected: PASS.

- [x] **Step 7: Regenerate bindings**

Run: `cargo run -p handshaker --bin export-bindings --features export-bindings`
Expected: `wrote …\src\ipc\bindings.ts`; `git diff` shows `FieldNodeIpc` with
`number`/`optional`, new `EnumValueIpc`, `EnumNodeIpc.values: EnumValueIpc[]`.

- [x] **Step 8: Update the TS consumers**

`src/features/bodyview/completion.ts` (~line 337), enum value suggestions:

```ts
    return en.values.map((v, i) => ({
      label: v.name,
      insertText: `"${v.name}"`,
      kind: "value" as const,
      sortText: sortKey(i),
```

`src/features/bodyview/hints.ts` (~line 19), enum preview:

```ts
      const head = en.values.slice(0, ENUM_PREVIEW_MAX).map((v) => v.name).join(" | ");
```

(`tail` length check is count-based — unchanged.)

- [x] **Step 9: Update the four bodyview test factories**

In `hints.test.ts`, `ghost.test.ts`, `validate.test.ts` the shared factory gains
two defaults (before `...extra`):

```ts
function f(json: string, label: string, kind: FieldNodeIpc["value_kind"], extra: Partial<FieldNodeIpc> = {}): FieldNodeIpc {
  return {
    json_name: json, proto_name: json, type_label: label, value_kind: kind,
    repeated: false, message_type: null, enum_type: null, oneof_group: null,
    number: 1, optional: false, ...extra,
  };
}
```

In `completion.test.ts` the local `f` (line 40) gains the same two literals
(`number: 1, optional: false,`). Enum fixtures become objects:

- `hints.test.ts:31-32`:
  `values: [{ name: "ASC", number: 0 }, { name: "DESC", number: 1 }]` and
  `values: ["A", "B", "C", "D", "E", "F"].map((name, i) => ({ name, number: i }))`
- `hints.test.ts:86`: `values: [{ name: "N", number: 0 }, { name: "S", number: 1 }]`
- `completion.test.ts:20` and `:238`:
  `values: [{ name: "UNKNOWN", number: 0 }, { name: "ACTIVE", number: 1 }]`

- [x] **Step 10: Run the frontend gate**

Run: `pnpm lint; if ($?) { pnpm test }`
Expected: lint clean, all tests pass.

- [x] **Step 11: Commit**

```powershell
git -C . add -A
git -C . commit -m "feat(schema): field numbers, proto3 optional flag, enum value numbers"
```

> ✅ 2026-06-11: done — commit `193715b` + review follow-up `cb08bc4`
> (redundant `as u32` cast dropped). Gates: core 125 / handshaker 43 /
> tsc clean / vitest 732. Quality-review note for будущего касания
> `oneof_info`: synthetic-проверку можно ужесточить через
> `field.field_descriptor_proto().proto3_optional()` вместо name-эвристики.

🧹 **/clear-чекпойнт** — конец Phase A. ✅ пройден 2026-06-11.

---

## Phase B — renderer and components (Tasks 3–5)

### Task 3: Pure proto renderer — `proto.ts`

**Files:**
- Create: `src/features/contract/proto.ts`
- Create: `src/features/contract/proto.test.ts`

- [x] **Step 1: Write the failing tests**

`src/features/contract/proto.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import type { MessageSchemaIpc, FieldNodeIpc } from "@/ipc/bindings";
import { renderProtoDoc, type ProtoBlock, type ProtoToken } from "./proto";

function f(
  proto: string,
  number: number,
  label: string,
  kind: FieldNodeIpc["value_kind"],
  extra: Partial<FieldNodeIpc> = {},
): FieldNodeIpc {
  const json = proto.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
  return {
    json_name: json, proto_name: proto, type_label: label, value_kind: kind,
    number, optional: false, repeated: false, message_type: null, enum_type: null,
    oneof_group: null, ...extra,
  };
}

const lineText = (l: ProtoToken[]) => l.map((t) => t.text).join("");
const blockText = (b: ProtoBlock) => b.lines.map(lineText).join("\n");
const allTokens = (b: ProtoBlock) => b.lines.flat();

const SCHEMA: MessageSchemaIpc = {
  root: "t.Req",
  messages: [
    {
      full_name: "t.Req",
      fields: [
        f("query", 1, "string", "scalar"),
        f("items", 2, "repeated Item", "message", { repeated: true, message_type: "t.Item" }),
        f("filter", 3, "Filter", "message", { message_type: "t.Filter" }),
        f("counts", 4, "map<string, int32>", "map"),
        f("by_id", 5, "map<string, Item>", "map", { message_type: "t.Item" }),
        f("user_id", 6, "string", "scalar", { oneof_group: "target" }),
        f("email", 7, "string", "scalar", { oneof_group: "target" }),
        f("nick", 8, "string", "scalar", { optional: true }),
        f("sort", 9, "Status", "enum", { enum_type: "t.Status" }),
      ],
    },
    { full_name: "t.Item", fields: [f("name", 1, "string", "scalar")] },
    { full_name: "t.Filter", fields: [f("parent", 1, "Filter", "message", { message_type: "t.Filter" })] },
  ],
  enums: [
    { full_name: "t.Status", values: [{ name: "UNKNOWN", number: 0 }, { name: "ACTIVE", number: 1 }] },
  ],
};

describe("renderProtoDoc", () => {
  it("prints the root message first, then the rest in schema order, then enums", () => {
    const doc = renderProtoDoc(SCHEMA);
    expect(doc.blocks.map((b) => b.fullName)).toEqual(["t.Req", "t.Item", "t.Filter", "t.Status"]);
  });

  it("renders the full proto shape: scalars, repeated, refs, maps, oneof, optional", () => {
    const doc = renderProtoDoc(SCHEMA);
    expect(blockText(doc.blocks[0])).toBe(
      [
        "message Req {",
        "  string query = 1;",
        "  repeated Item items = 2;",
        "  Filter filter = 3;",
        "  map<string, int32> counts = 4;",
        "  map<string, Item> by_id = 5;",
        "  oneof target {",
        "    string user_id = 6;",
        "    string email = 7;",
        "  }",
        "  optional string nick = 8;",
        "  Status sort = 9;",
        "}",
      ].join("\n"),
    );
  });

  it("renders enum blocks with value numbers", () => {
    const doc = renderProtoDoc(SCHEMA);
    expect(blockText(doc.blocks[3])).toBe(
      ["enum Status {", "  UNKNOWN = 0;", "  ACTIVE = 1;", "}"].join("\n"),
    );
  });

  it("emits clickable typeRef tokens whose targets all resolve to printed blocks", () => {
    const doc = renderProtoDoc(SCHEMA);
    const printed = new Set(doc.blocks.map((b) => b.fullName));
    const refs = doc.blocks
      .flatMap(allTokens)
      .filter((t): t is Extract<ProtoToken, { kind: "typeRef" }> => t.kind === "typeRef");
    expect(refs.length).toBeGreaterThanOrEqual(4); // items, filter, by_id value, sort, parent
    for (const r of refs) expect(printed.has(r.target)).toBe(true);
  });

  it("a recursive self-reference is just a ref to the already-printed block", () => {
    const doc = renderProtoDoc(SCHEMA);
    const filter = doc.blocks.find((b) => b.fullName === "t.Filter")!;
    const ref = allTokens(filter).find((t) => t.kind === "typeRef");
    expect(ref).toMatchObject({ text: "Filter", target: "t.Filter" });
  });

  it("carries tooltips: full name on type names and refs, json_name on field names", () => {
    const doc = renderProtoDoc(SCHEMA);
    const header = doc.blocks[0].lines[0].find((t) => t.kind === "name");
    expect(header).toMatchObject({ text: "Req", tooltip: "t.Req" });
    const byId = doc.blocks[0].lines.find((l) => lineText(l).includes("by_id"))!;
    expect(byId.find((t) => t.kind === "name")).toMatchObject({ text: "by_id", tooltip: "byId" });
    expect(byId.find((t) => t.kind === "typeRef")).toMatchObject({ text: "Item", tooltip: "t.Item" });
  });

  it("a non-contiguous oneof run opens a second block", () => {
    const schema: MessageSchemaIpc = {
      root: "t.M",
      messages: [{
        full_name: "t.M",
        fields: [
          f("a", 1, "string", "scalar", { oneof_group: "g" }),
          f("mid", 2, "string", "scalar"),
          f("b", 3, "string", "scalar", { oneof_group: "g" }),
        ],
      }],
      enums: [],
    };
    const text = blockText(renderProtoDoc(schema).blocks[0]);
    expect(text.match(/oneof g \{/g)).toHaveLength(2);
  });

  it("prints full names when short names collide", () => {
    const schema: MessageSchemaIpc = {
      root: "a.Filter",
      messages: [
        { full_name: "a.Filter", fields: [f("x", 1, "Filter", "message", { message_type: "b.Filter" })] },
        { full_name: "b.Filter", fields: [] },
      ],
      enums: [],
    };
    const doc = renderProtoDoc(schema);
    expect(blockText(doc.blocks[0])).toBe(
      ["message a.Filter {", "  b.Filter x = 1;", "}"].join("\n"),
    );
    expect(blockText(doc.blocks[1])).toBe("message b.Filter {}");
  });

  it("prints an empty message on one line", () => {
    const schema: MessageSchemaIpc = {
      root: "t.Empty",
      messages: [{ full_name: "t.Empty", fields: [] }],
      enums: [],
    };
    expect(blockText(renderProtoDoc(schema).blocks[0])).toBe("message Empty {}");
  });
});
```

- [x] **Step 2: Run to verify failure**

Run: `pnpm vitest run src/features/contract/proto.test.ts`
Expected: FAIL — `Failed to resolve import "./proto"`.

- [x] **Step 3: Implement `proto.ts`**

```ts
import type { MessageSchemaIpc, MessageNodeIpc, EnumNodeIpc, FieldNodeIpc } from "@/ipc/bindings";

export type ProtoToken =
  | { kind: "keyword"; text: string }
  | { kind: "scalar"; text: string }
  | { kind: "typeRef"; text: string; target: string; tooltip: string }
  | { kind: "name"; text: string; tooltip?: string }
  | { kind: "punct"; text: string };

export interface ProtoBlock {
  /** Full type name — the click-to-scroll anchor id. */
  fullName: string;
  lines: ProtoToken[][];
}

export interface ProtoDoc {
  blocks: ProtoBlock[];
}

function shortName(full: string): string {
  return full.split(".").pop() ?? full;
}

/** Display name per printed type: short last segment, or the full name when the
 *  short name collides across the document (e.g. `a.Filter` + `b.Filter`). */
function displayNames(schema: MessageSchemaIpc): Map<string, string> {
  const all = [...schema.messages.map((m) => m.full_name), ...schema.enums.map((e) => e.full_name)];
  const counts = new Map<string, number>();
  for (const fn of all) {
    const s = shortName(fn);
    counts.set(s, (counts.get(s) ?? 0) + 1);
  }
  return new Map(all.map((fn) => [fn, (counts.get(shortName(fn)) ?? 0) > 1 ? fn : shortName(fn)]));
}

function typeRef(target: string, names: Map<string, string>): ProtoToken {
  return { kind: "typeRef", text: names.get(target) ?? shortName(target), target, tooltip: target };
}

function fieldLine(fl: FieldNodeIpc, names: Map<string, string>, indent: string): ProtoToken[] {
  const out: ProtoToken[] = [{ kind: "punct", text: indent }];
  if (fl.optional) out.push({ kind: "keyword", text: "optional " });
  if (fl.repeated) out.push({ kind: "keyword", text: "repeated " });
  const target = fl.message_type ?? fl.enum_type;
  if (fl.value_kind === "map") {
    // Our own builder format `map<key, Value>` — recover the key label from it.
    const key = fl.type_label.slice("map<".length, fl.type_label.indexOf(","));
    out.push({ kind: "keyword", text: "map<" }, { kind: "scalar", text: key }, { kind: "punct", text: ", " });
    if (target) out.push(typeRef(target, names));
    else out.push({ kind: "scalar", text: fl.type_label.slice(fl.type_label.indexOf(",") + 2, -1) });
    out.push({ kind: "punct", text: "> " });
  } else if (target) {
    out.push(typeRef(target, names), { kind: "punct", text: " " });
  } else {
    const base = fl.repeated ? fl.type_label.replace(/^repeated /, "") : fl.type_label;
    out.push({ kind: "scalar", text: base }, { kind: "punct", text: " " });
  }
  out.push({ kind: "name", text: fl.proto_name, tooltip: fl.json_name });
  out.push({ kind: "punct", text: ` = ${fl.number};` });
  return out;
}

function messageBlock(m: MessageNodeIpc, names: Map<string, string>): ProtoBlock {
  const display = names.get(m.full_name) ?? shortName(m.full_name);
  const header: ProtoToken[] = [
    { kind: "keyword", text: "message " },
    { kind: "name", text: display, tooltip: m.full_name },
  ];
  if (m.fields.length === 0) {
    return { fullName: m.full_name, lines: [[...header, { kind: "punct", text: " {}" }]] };
  }
  const lines: ProtoToken[][] = [[...header, { kind: "punct", text: " {" }]];
  let i = 0;
  while (i < m.fields.length) {
    const group = m.fields[i].oneof_group;
    if (group !== null) {
      lines.push([
        { kind: "punct", text: "  " },
        { kind: "keyword", text: "oneof " },
        { kind: "name", text: group },
        { kind: "punct", text: " {" },
      ]);
      while (i < m.fields.length && m.fields[i].oneof_group === group) {
        lines.push(fieldLine(m.fields[i], names, "    "));
        i++;
      }
      lines.push([{ kind: "punct", text: "  }" }]);
    } else {
      lines.push(fieldLine(m.fields[i], names, "  "));
      i++;
    }
  }
  lines.push([{ kind: "punct", text: "}" }]);
  return { fullName: m.full_name, lines };
}

function enumBlock(e: EnumNodeIpc, names: Map<string, string>): ProtoBlock {
  const display = names.get(e.full_name) ?? shortName(e.full_name);
  return {
    fullName: e.full_name,
    lines: [
      [
        { kind: "keyword", text: "enum " },
        { kind: "name", text: display, tooltip: e.full_name },
        { kind: "punct", text: " {" },
      ],
      ...e.values.map((v): ProtoToken[] => [
        { kind: "punct", text: "  " },
        { kind: "name", text: v.name },
        { kind: "punct", text: ` = ${v.number};` },
      ]),
      [{ kind: "punct", text: "}" }],
    ],
  };
}

/** Proto-source listing of a flat schema: root message first, remaining messages
 *  in schema (BFS) order, then enums. One block per type — recursion needs no
 *  special handling (named references, never inlined). */
export function renderProtoDoc(schema: MessageSchemaIpc): ProtoDoc {
  const names = displayNames(schema);
  const root = schema.messages.filter((m) => m.full_name === schema.root);
  const rest = schema.messages.filter((m) => m.full_name !== schema.root);
  return {
    blocks: [
      ...[...root, ...rest].map((m) => messageBlock(m, names)),
      ...schema.enums.map((e) => enumBlock(e, names)),
    ],
  };
}
```

- [x] **Step 4: Run to verify pass**

Run: `pnpm vitest run src/features/contract/proto.test.ts`
Expected: PASS (9 tests).

- [x] **Step 5: Commit**

```powershell
git -C . add src/features/contract/proto.ts src/features/contract/proto.test.ts
git -C . commit -m "feat(contract): pure proto-source renderer (ProtoDoc tokens)"
```

> ✅ 2026-06-11: done — commit `7ae82bc` + review follow-up `427737a` (test
> fixtures: repeated-scalar и enum-map ветки, точная `toHaveLength(6)`-ассерция).
> Spec+quality ревью пройдены. Заметка ревью: `pnpm lint` в этом репо — только
> `tsc -b`, eslint нет (поправить формулировку gate в баннере на Task 8).

### Task 4: `ProtoView` component + token colors + flash CSS

**Files:**
- Create: `src/features/contract/ProtoView.tsx`
- Create: `src/features/contract/ProtoView.test.tsx`
- Modify: `src/styles/globals.css` (append to the end)

- [x] **Step 1: Write the failing tests**

`src/features/contract/ProtoView.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeAll } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ProtoView } from "./ProtoView";
import type { ProtoDoc } from "./proto";

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
  if (!window.matchMedia) {
    Object.defineProperty(window, "matchMedia", {
      value: (query: string) => ({
        matches: false, media: query,
        addEventListener: () => {}, removeEventListener: () => {},
      }),
    });
  }
});

const DOC: ProtoDoc = {
  blocks: [
    {
      fullName: "t.Req",
      lines: [
        [
          { kind: "keyword", text: "message " },
          { kind: "name", text: "Req", tooltip: "t.Req" },
          { kind: "punct", text: " {" },
        ],
        [
          { kind: "punct", text: "  " },
          { kind: "typeRef", text: "Item", target: "t.Item", tooltip: "t.Item" },
          { kind: "punct", text: " " },
          { kind: "name", text: "an_item", tooltip: "anItem" },
          { kind: "punct", text: " = 1;" },
        ],
        [{ kind: "punct", text: "}" }],
      ],
    },
    {
      fullName: "t.Item",
      lines: [[
        { kind: "keyword", text: "message " },
        { kind: "name", text: "Item", tooltip: "t.Item" },
        { kind: "punct", text: " {}" },
      ]],
    },
  ],
};

describe("ProtoView", () => {
  it("renders tokens with kind classes and tooltips", () => {
    const { container } = render(<ProtoView doc={DOC} />);
    const field = screen.getByText("an_item");
    expect(field).toHaveAttribute("title", "anItem");
    expect(field.className).toContain("hs-proto-name");
    expect(container.querySelector(".hs-proto-kw")).not.toBeNull();
    expect(container.querySelector(".hs-proto-punct")).not.toBeNull();
  });

  it("clicking a type ref scrolls its block into view and flashes it", () => {
    const { container } = render(<ProtoView doc={DOC} />);
    fireEvent.click(screen.getByRole("button", { name: "Item" }));
    const target = container.querySelector('[data-block="t.Item"]') as HTMLElement;
    expect(target.classList.contains("hs-proto-flash")).toBe(true);
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
  });
});
```

- [x] **Step 2: Run to verify failure**

Run: `pnpm vitest run src/features/contract/ProtoView.test.tsx`
Expected: FAIL — `Failed to resolve import "./ProtoView"`.

- [x] **Step 3: Implement `ProtoView.tsx`**

```tsx
import { useRef } from "react";
import { cn } from "@/lib/cn";
import type { ProtoDoc, ProtoToken } from "./proto";

const TOKEN_CLASS: Record<ProtoToken["kind"], string> = {
  keyword: "hs-proto-kw",
  scalar: "hs-proto-scalar",
  typeRef: "hs-proto-ref",
  name: "hs-proto-name",
  punct: "hs-proto-punct",
};

/** Read-only proto-source listing. Type references are buttons: click scrolls
 *  the target block into view and flashes it. */
export function ProtoView({ doc }: { doc: ProtoDoc }) {
  const rootRef = useRef<HTMLDivElement>(null);

  const jump = (target: string) => {
    const el = rootRef.current?.querySelector<HTMLElement>(`[data-block="${CSS.escape(target)}"]`);
    if (!el) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" });
    // Restart the flash when re-clicking the same target: remove → reflow → add.
    el.classList.remove("hs-proto-flash");
    void el.offsetWidth;
    el.classList.add("hs-proto-flash");
  };

  return (
    <div ref={rootRef} className="px-3.5 py-2 font-mono text-xs leading-6">
      {doc.blocks.map((b) => (
        <div key={b.fullName} data-block={b.fullName} className="mb-3 last:mb-0">
          {b.lines.map((line, i) => (
            <div key={i} className="whitespace-pre">
              {line.map((t, j) =>
                t.kind === "typeRef" ? (
                  <button
                    key={j}
                    type="button"
                    title={t.tooltip}
                    onClick={() => jump(t.target)}
                    className={cn(TOKEN_CLASS[t.kind], "hover:underline")}
                  >
                    {t.text}
                  </button>
                ) : (
                  <span
                    key={j}
                    title={t.kind === "name" ? t.tooltip : undefined}
                    className={TOKEN_CLASS[t.kind]}
                  >
                    {t.text}
                  </span>
                ),
              )}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
```

- [x] **Step 4: Add the token colors + flash animation to `globals.css`**

Append at the end of `src/styles/globals.css` (the `--syntax-*` HSL triples are
already theme-aware — defined for both light and dark):

```css
/* Contract tab — proto listing. Token colors ride the shared --syntax-* vars;
   the flash highlights a block after a click-to-scroll jump. */
.hs-proto-kw { color: hsl(var(--syntax-num)); }
.hs-proto-scalar { color: hsl(var(--syntax-str)); }
.hs-proto-ref { color: hsl(var(--syntax-key)); }
.hs-proto-name { color: hsl(var(--foreground)); }
.hs-proto-punct { color: hsl(var(--syntax-punct)); }
@keyframes hs-proto-flash {
  from { background-color: hsl(var(--accent)); }
  to { background-color: transparent; }
}
.hs-proto-flash { animation: hs-proto-flash 800ms var(--ease-out); }
```

(The global `prefers-reduced-motion` rule in this file already suppresses
animations — the flash is decorative, that's the intended degradation.)

- [x] **Step 5: Run to verify pass**

Run: `pnpm vitest run src/features/contract/ProtoView.test.tsx`
Expected: PASS (2 tests).

- [x] **Step 6: Commit**

```powershell
git -C . add src/features/contract/ProtoView.tsx src/features/contract/ProtoView.test.tsx src/styles/globals.css
git -C . commit -m "feat(contract): ProtoView with syntax colors and click-to-scroll"
```

> ✅ 2026-06-11: done — commit `96b8bca` + review follow-up `8edcbd8` (точные
> args-ассерции scrollIntoView, тест reduced-motion ветки, мёртвый matchMedia-мок
> убран, NB-комментарий про classList/static className в `jump()`). Spec+quality
> ревью пройдены. Полировка на live-проход Task 6: `scroll-margin-top` у блоков,
> если приземление вплотную к верху выглядит тесно.

### Task 5: `ContractView` — side switch + placeholders

**Files:**
- Create: `src/features/contract/ContractView.tsx`
- Create: `src/features/contract/ContractView.test.tsx`

- [x] **Step 1: Write the failing tests**

`src/features/contract/ContractView.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ContractView } from "./ContractView";
import type { MessageSchemaIpc } from "@/ipc/bindings";

const IN: MessageSchemaIpc = {
  root: "t.In",
  messages: [{
    full_name: "t.In",
    fields: [{
      json_name: "query", proto_name: "query", type_label: "string", value_kind: "scalar",
      repeated: false, message_type: null, enum_type: null, oneof_group: null,
      number: 1, optional: false,
    }],
  }],
  enums: [],
};
const OUT: MessageSchemaIpc = {
  root: "t.Out",
  messages: [{ full_name: "t.Out", fields: [] }],
  enums: [],
};

describe("ContractView", () => {
  it("renders the selected side's schema and reports the switch state", () => {
    const onSide = vi.fn();
    render(<ContractView method="Search" input={IN} output={OUT} side="request" onSide={onSide} />);
    expect(screen.getByText("query")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Request" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Response" })).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(screen.getByRole("button", { name: "Response" }));
    expect(onSide).toHaveBeenCalledWith("response");
  });

  it("renders the response side when selected, and the method name", () => {
    render(<ContractView method="Search" input={IN} output={OUT} side="response" onSide={vi.fn()} />);
    expect(screen.getByText(/Out/)).toBeInTheDocument();
    expect(screen.queryByText("query")).toBeNull();
    expect(screen.getByText("Search")).toBeInTheDocument();
  });

  it("asks to pick a method when none is selected", () => {
    render(<ContractView method="" input={null} output={null} side="request" onSide={vi.fn()} />);
    expect(screen.getByText(/Выбери метод/)).toBeInTheDocument();
  });

  it("shows the unavailable placeholder when the schema is missing", () => {
    render(<ContractView method="Search" input={null} output={OUT} side="request" onSide={vi.fn()} />);
    expect(screen.getByText(/Контракт недоступен/)).toBeInTheDocument();
  });
});
```

- [x] **Step 2: Run to verify failure**

Run: `pnpm vitest run src/features/contract/ContractView.test.tsx`
Expected: FAIL — `Failed to resolve import "./ContractView"`.

- [x] **Step 3: Implement `ContractView.tsx`**

```tsx
import { useMemo } from "react";
import type { MessageSchemaIpc } from "@/ipc/bindings";
import { cn } from "@/lib/cn";
import { renderProtoDoc } from "./proto";
import { ProtoView } from "./ProtoView";

export type ContractSide = "request" | "response";

export interface ContractViewProps {
  /** Method display name (plain name, not full path); empty → "pick a method" hint. */
  method: string;
  input: MessageSchemaIpc | null;
  output: MessageSchemaIpc | null;
  side: ContractSide;
  onSide: (side: ContractSide) => void;
}

const SIDES: { value: ContractSide; label: string }[] = [
  { value: "request", label: "Request" },
  { value: "response", label: "Response" },
];

/** Contract-tab content: Request|Response segmented switch + proto listing.
 *  Side state lives in the parent so it survives Response-panel tab switches. */
export function ContractView({ method, input, output, side, onSide }: ContractViewProps) {
  const schema = side === "request" ? input : output;
  const doc = useMemo(() => (schema ? renderProtoDoc(schema) : null), [schema]);
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-8 flex-none items-center gap-2 border-b border-border px-3.5">
        <div className="flex items-center overflow-hidden rounded-md border border-border text-xs">
          {SIDES.map((s) => (
            <button
              key={s.value}
              type="button"
              aria-pressed={side === s.value}
              onClick={() => onSide(s.value)}
              className={cn(
                "px-2.5 py-0.5",
                side === s.value ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {s.label}
            </button>
          ))}
        </div>
        <span className="ml-auto truncate font-mono text-[11px] text-muted-foreground">{method}</span>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {method.trim().length === 0 ? (
          <div className="px-3.5 py-3 text-xs text-muted-foreground">
            Выбери метод — его контракт появится здесь.
          </div>
        ) : doc ? (
          <ProtoView doc={doc} />
        ) : (
          <div className="px-3.5 py-3 text-xs text-muted-foreground">
            Контракт недоступен — схема метода не получена (reflection выключен или
            сервер недоступен).
          </div>
        )}
      </div>
    </div>
  );
}
```

- [x] **Step 4: Run to verify pass**

Run: `pnpm vitest run src/features/contract/ContractView.test.tsx`
Expected: PASS (4 tests).

- [x] **Step 5: Commit**

```powershell
git -C . add src/features/contract/ContractView.tsx src/features/contract/ContractView.test.tsx
git -C . commit -m "feat(contract): ContractView with Request/Response side switch"
```

> ✅ 2026-06-11: done — commit `3f925c1`, spec+quality ревью пройдены без правок
> (4/4 теста, tsc чистый). Minor-заметки ревью ушли в live-чеклист Task 8
> (scroll-carryover между сторонами, `scroll-margin-top`).

🧹 **/clear-чекпойнт** — конец Phase B. ✅ пройден 2026-06-11.

---

## Phase C — integration and gate (Tasks 6–8)

### Task 6: Contract tab in `ResponsePanel`

**Files:**
- Modify: `src/features/response/ResponsePanel.tsx`
- Modify: `src/features/response/ResponsePanel.test.tsx`

- [x] **Step 1: Write the failing tests**

Append to `ResponsePanel.test.tsx` (the existing monaco/use-prefs mocks at the
top of the file already cover these tests; add `fireEvent` to the testing-library
import and `MessageSchemaIpc` to the bindings import):

```tsx
const inSchema: MessageSchemaIpc = {
  root: "t.In",
  messages: [{
    full_name: "t.In",
    fields: [{
      json_name: "query", proto_name: "query", type_label: "string", value_kind: "scalar",
      repeated: false, message_type: null, enum_type: null, oneof_group: null,
      number: 1, optional: false,
    }],
  }],
  enums: [],
};
const outSchema: MessageSchemaIpc = {
  root: "t.Out",
  messages: [{ full_name: "t.Out", fields: [] }],
  enums: [],
};
const contract = { input: inSchema, output: outSchema, method: "Search" };

describe("ResponsePanel contract tab", () => {
  it("shows no Contract tab without the contract prop (history panels)", () => {
    render(<ResponsePanel state="idle" outcome={null} />);
    expect(screen.queryByRole("tab", { name: "Contract" })).toBeNull();
    expect(screen.getByText(/awaiting first call/i)).toBeInTheDocument();
  });

  it("defaults to the Contract tab pre-send when schemas are available", () => {
    render(<ResponsePanel state="idle" outcome={null} contract={contract} />);
    expect(screen.getByRole("tab", { name: "Contract" })).toBeInTheDocument();
    expect(screen.getByText("query")).toBeInTheDocument();
    expect(screen.queryByText(/awaiting first call/i)).toBeNull();
  });

  it("auto-switches to Body when a response arrives on the auto-chosen Contract tab", () => {
    const { rerender } = render(<ResponsePanel state="idle" outcome={null} contract={contract} />);
    expect(screen.getByText("query")).toBeInTheDocument();
    rerender(<ResponsePanel state="success" outcome={ok} contract={contract} />);
    expect(screen.getByTestId("monaco")).toBeInTheDocument();
    expect(screen.queryByText("query")).toBeNull();
  });

  it("a manual Contract pick survives a response arrival", () => {
    const { rerender } = render(<ResponsePanel state="idle" outcome={null} contract={contract} />);
    // Two explicit clicks: leaving and re-entering Contract marks the choice as
    // manual without relying on whether clicking the active tab fires onChange.
    fireEvent.click(screen.getByRole("tab", { name: "Body" }));
    fireEvent.click(screen.getByRole("tab", { name: "Contract" }));
    rerender(<ResponsePanel state="success" outcome={ok} contract={contract} />);
    expect(screen.getByText("query")).toBeInTheDocument();
    expect(screen.queryByTestId("monaco")).toBeNull();
  });

  it("the side switch survives leaving and re-entering the Contract tab", () => {
    render(<ResponsePanel state="success" outcome={ok} contract={contract} />);
    fireEvent.click(screen.getByRole("tab", { name: "Contract" }));
    fireEvent.click(screen.getByRole("button", { name: "Response" }));
    expect(screen.getByText(/Out/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "Body" }));
    fireEvent.click(screen.getByRole("tab", { name: "Contract" }));
    expect(screen.getByRole("button", { name: "Response" })).toHaveAttribute("aria-pressed", "true");
  });
});
```

- [x] **Step 2: Run to verify failure**

Run: `pnpm vitest run src/features/response/ResponsePanel.test.tsx`
Expected: new tests FAIL (no `contract` prop / no Contract tab yet); old ones pass.

- [x] **Step 3: Implement the tab**

In `ResponsePanel.tsx`:

```tsx
import { ContractView, type ContractSide } from "@/features/contract/ContractView";

type ResponseTab = "body" | "trailers" | "headers" | "contract";

/** Editable-draft contract for the Contract tab. Omit/null → three tabs (history). */
export interface ContractInfo {
  input: MessageSchemaIpc | null;
  output: MessageSchemaIpc | null;
  method: string;
}
```

`ResponsePanelProps` gains `contract?: ContractInfo | null;`; the component
destructures it. State additions (after the existing `tab` state):

```tsx
  const [side, setSide] = useState<ContractSide>("request");
  // A manual tab choice wins over both the pre-send default and the
  // response-arrival auto-switch.
  const userPickedTab = useRef(false);

  const hasSchemas = !!contract && (contract.input !== null || contract.output !== null);
  useEffect(() => {
    if (state === "idle" && hasSchemas && !userPickedTab.current) setTab("contract");
  }, [state, hasSchemas]);

  // A response just arrived (idle/sending → success|error): pull the user from
  // the auto-chosen contract back to the body. Manual picks stay put.
  const prevState = useRef(state);
  useEffect(() => {
    const arrived = (state === "success" || state === "error") && prevState.current !== state;
    prevState.current = state;
    if (arrived && !userPickedTab.current) setTab((t) => (t === "contract" ? "body" : t));
  }, [state]);
```

`UnderlineTabs` becomes:

```tsx
        <UnderlineTabs
          value={tab}
          onChange={(v) => {
            userPickedTab.current = true;
            setTab(v as ResponseTab);
          }}
          busy={showProgress}
          items={[
            { value: "body", label: "Body" },
            { value: "trailers", label: "Trailers", hint: trailers.length || undefined },
            { value: "headers", label: "Headers", hint: headers.length || undefined },
            ...(contract ? [{ value: "contract", label: "Contract" }] : []),
          ]}
        />
```

Content area: gate the idle empty-state to non-contract tabs and add the
contract branch (after the `EmptyState` line):

```tsx
      {state === "idle" && tab !== "contract" && (
        <EmptyState
          icon={<Activity className="size-[18px]" />}
          title="Awaiting first call"
          desc="Hit Send to invoke. Response body, trailers and timing will appear here."
        />
      )}
      {tab === "contract" && contract && (
        <div className="min-h-0 flex-1">
          <ContractView
            method={contract.method}
            input={contract.input}
            output={contract.output}
            side={side}
            onSide={setSide}
          />
        </div>
      )}
```

The existing body/trailers/headers branches already check `tab === "…"`, so they
are mutually exclusive with the contract tab.

- [x] **Step 4: Run to verify pass**

Run: `pnpm vitest run src/features/response/ResponsePanel.test.tsx`
Expected: PASS (all, including the 4 pre-existing tests).

- [x] **Step 5: Commit**

```powershell
git -C . add src/features/response/ResponsePanel.tsx src/features/response/ResponsePanel.test.tsx
git -C . commit -m "feat(response): Contract tab with default-tab and auto-switch logic"
```

> ✅ 2026-06-12: done — commit `97ab7ea`, spec+quality ревью пройдены (9/9 в файле,
> полный сьют 753, tsc чистый). Заметки ревью: (1) в Task 7 закрыть latent-ветку
> «`contract` исчез при выбранном табе Contract → пустая панель» (гард
> `if (!contract && tab === "contract") setTab("body")`), если реальный caller
> может так сделать; (2) на live-проход Task 8 — однокадровый flash «Awaiting
> first call» при маунте с готовыми схемами (лечится lazy-init `useState`) и
> решение, должен ли `userPickedTab` пере-взводиться при смене метода.

### Task 7: CallPanel wiring + integration tests

**Files:**
- Modify: `src/features/workflow/CallPanel.tsx` (ResponseSlot + call site)
- Modify: `src/features/workflow/CallPanel.editable.test.tsx`

- [x] **Step 1: Write the failing tests**

Add to `CallPanel.editable.test.tsx` (same render pattern as the file's other
tests; the mocked `grpcMessageSchema` resolves both sides to `null`, and `draft`
has method `GetX` → the tab shows the "Контракт недоступен" placeholder):

```tsx
describe("CallPanel contract tab", () => {
  it("shows the Contract tab on the editable draft", () => {
    render(
      <TooltipProvider>
        <CallPanel step={draft} onPatch={() => {}} editable />
      </TooltipProvider>,
    );
    fireEvent.click(screen.getByRole("tab", { name: "Contract" }));
    // schema fetch is mocked away → both sides null → placeholder text
    expect(screen.getByText(/Контракт недоступен/)).toBeInTheDocument();
  });

  it("offers no Contract tab on non-editable (history) panels", () => {
    render(
      <TooltipProvider>
        <CallPanel step={draft} onPatch={() => {}} />
      </TooltipProvider>,
    );
    expect(screen.queryByRole("tab", { name: "Contract" })).toBeNull();
  });
});
```

- [x] **Step 2: Run to verify failure**

Run: `pnpm vitest run src/features/workflow/CallPanel.editable.test.tsx`
Expected: new tests FAIL (no Contract tab rendered yet).

- [x] **Step 3: Wire the contract through**

In `CallPanel.tsx` import `type ContractInfo` from
`@/features/response/ResponsePanel`, pass it at the call site:

```tsx
            <ResponseSlot
              step={step}
              schema={outputSchema}
              contract={editable ? { input: schema, output: outputSchema, method: step.method } : null}
            />
```

and extend `ResponseSlot`:

```tsx
function ResponseSlot({ step, schema, contract }: { step: Step; schema: MessageSchemaIpc | null; contract: ContractInfo | null }) {
  // … respState mapping unchanged …
  return <ResponsePanel state={respState} outcome={step.outcome} error={step.error} schema={schema} contract={contract} />;
}
```

- [x] **Step 4: Run to verify pass**

Run: `pnpm vitest run src/features/workflow/CallPanel.editable.test.tsx`
Expected: PASS.

- [x] **Step 5: Commit**

```powershell
git -C . add src/features/workflow/CallPanel.tsx src/features/workflow/CallPanel.editable.test.tsx
git -C . commit -m "feat(workflow): thread method contract into the Response panel tab"
```

> ✅ 2026-06-12: done — commit `34b1a48` + review follow-up `03da8da`
> (side-aware mock `grpcMessageSchema`: тест пиняет назначение input/output
> сторон контракта, мутационная проверка swap'а пройдена). Spec+quality ревью
> пройдены. Latent-гард «contract truthy→falsy» НЕ добавлен — анализ подтвердил
> недостижимость: единственный продакшн-рендер `ResponsePanel` — `ResponseSlot`,
> а `editable` во всех трёх call-сайтах `CallPanel` — JSX-литерал
> (FocusView always-true, List/LedgerView omitted).

### Task 8: Full gate + docs + live-pass handoff

**Files:**
- Modify: `docs/superpowers/plans/2026-06-11-contract-tab-proto-view.md` (banner)
- Modify: `CLAUDE.md` (Active-work paragraph)

- [x] **Step 1: Run the full gate**

```powershell
pnpm lint
pnpm test
cargo test -p handshaker-core
cargo test -p handshaker
pnpm build
```

Expected: all green. Record the final FE test count for the banner.

> ✅ 2026-06-12: gate green — tsc clean · vitest 756 (111 files) ·
> `cargo test -p handshaker-core` + `-p handshaker` ok · `pnpm build` ok.

- [x] **Step 2: Update this plan's banner**

Set status to `🚧 code-complete — awaiting live WebView2 verification`, list the
task commits and the gate result.

- [x] **Step 3: Update `CLAUDE.md` Active-work**

Reword the Group B #3 paragraph: overlay заменён табом Contract в Response-панели
(proto-вид, спек 2026-06-11), код готов, остаётся live-проверка и финиш ветки.

- [x] **Step 4: Commit docs**

```powershell
git -C . add docs/superpowers/plans/2026-06-11-contract-tab-proto-view.md CLAUDE.md
git -C . commit -m "docs(plan): contract tab proto view - code-complete banner"
```

- [ ] **Step 5: Live verification (user-driven, `pnpm tauri dev` + Ctrl+R)**

- [ ] Выбор метода → Response-панель сама открывает таб **Contract** с proto-листингом (Request-сторона).
- [ ] Переключатель **Request | Response** работает; выбор стороны переживает уход на Body и обратно.
- [ ] Скролл при переключении стороны: позиция прошлой стороны не должна оставлять новую «в середине документа» (если мешает — `key={side}` на скроллере); приземление click-to-scroll не вплотную к верху (иначе `scroll-margin-top`).
- [ ] Клик по имени типа (например, вложенного message) скроллит к его определению с короткой вспышкой.
- [ ] Tooltip на имени поля показывает `json_name`; на имени типа — полное имя.
- [ ] `optional`, `repeated`, `map<…>`, `oneof { … }`, номера полей и enum-значений выглядят как в .proto.
- [ ] Send → автопереключение на **Body**; если таб Contract был выбран вручную — остаётся.
- [ ] History-панель — три таба, без Contract.
- [ ] Тоггл хинтов, ghost, автокомплит, `↺`, response-хинты — без регрессий (оверлея больше нет).
- [ ] Светлая/тёмная тема — цвета токенов читаемы (общие `--syntax-*`).

- [ ] **Step 6: Finish (user green light required)**

After the user confirms the checklist: flip this plan's banner to
`🎉 feature-complete — live-verified <date>`, then run
`superpowers:finishing-a-development-branch` — ff-merge to `main`, `git mv` the
2026-06-10 and 2026-06-11 plan+spec files to `archive/`, update the `CLAUDE.md`
Active-work section and the memory index. Do NOT remove the harness worktree.
