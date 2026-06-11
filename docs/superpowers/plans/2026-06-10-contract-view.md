# Method Contract View (Group B #3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Status:** 🚧 code-complete — all Phases A–D done (A+B 2026-06-10; C 2026-06-11; D 2026-06-11).
> Tasks 1–3: `124bda3`,`8994acc`,`cea3c57`; Tasks 4–8: `3420a9f`…`715bdeb`; Task 9: `4109ce1`;
> Task 10: `bdcb442`+`0a5f0ab`; Task 11: `ce2fcdf`+`00d2c61` (+ Task-9-регрессия чинена `fe744cb`);
> Task 12: `090daa8`+`ac79c6e`; Task 13: `43680b4`+`35154c5`. Spec+quality review пройдены на
> каждой задаче. **Полный гейт зелёный (Task 14 Step 1):** `pnpm lint` clean · 725 FE-тестов ·
> `pnpm build` ok · `cargo test -p handshaker-core` ok · `cargo test -p handshaker` 43/43.
> **Live-pass доводка 2026-06-11 (Phase E, по живой верификации):** ghost-фиксы `de1d424`
> (выравнивание у content origin + без italic), `8f157e6` (`applyFontInfo` на зону — шрифт/сетка),
> `404632e` (якорь над `}`), `f76e445` (подавление на однострочном объекте), `ad58092`
> (синхронный ре-якорь при изменении числа строк); продуктовые решения: `2302981` (без
> автозаполнения при выборе метода — пустой шаблон `{\n}`), `fc49ec2` (inlay-хинты только на
> ответе), `f1d550f` (комплит скрывает присутствующие ключи + занятые oneof). Гейт после
> доводки: lint clean · 739/739 FE.
> **Phase E готова:** Task 15 `52f8092` (error-tolerant ghost — висящая запятая), Task 16
> `5edc60a` (запятая-разделитель при принятии комплита), Task 17 `c11fe34` (sortText —
> proto-порядок в виджете). Гейт: lint clean · 746/746 FE.
> **Остаток:** Task 14 Step 2 — добить live-чеклист → баннер → `🎉 feature-complete` +
> ff-merge в `main`.
> Branch: `claude/nostalgic-jang-778d08` (harness worktree — do NOT `git worktree remove`).
> Spec: `docs/superpowers/specs/2026-06-10-contract-view-design.md` (approved 2026-06-10).

**Goal:** On-demand view of a gRPC method's contract while editing the request body: inline type hints + top-level ghost skeleton in the editor, and a floating Request/Response contract overlay — independently toggleable.

**Architecture:** The existing `grpc_message_schema` endpoint gains a `side: input|output` param (the flat-schema builder already works from any root message). The frontend fetches both sides; a Monaco `InlayHintsProvider` + one view zone render the inline surfaces from pure `hints.ts`/`ghost.ts` cores (reusing `parseWithSpans` + `descendSchema`), and a new `src/features/contract/` dir hosts the floating panel over a pure `tree.ts` row-derivation core.

**Tech Stack:** Rust / prost-reflect 0.16 · Tauri 2 + specta · React 18 + monaco-editor (`json-with-vars`) · Vitest + RTL · cargo test.

---

## Build / test commands

- Frontend: `pnpm test` (all) · `pnpm test <path>` (one file) · `pnpm lint` (tsc) · `pnpm build`
- Rust: `cargo test -p handshaker-core` · `cargo test -p handshaker`
- Regen TS bindings after IPC changes: `cargo run -p handshaker --bin export-bindings --features export-bindings --quiet`
  (writes `src/ipc/bindings.ts` — gitignored-but-tracked: **commit it, never hand-edit**)
- Fresh worktree: `pnpm install` → `pnpm build` (creates `dist/`) → only then anything `cargo` in `src-tauri` compiles (`generate_context!` needs `dist/`).

## File structure

| file | responsibility |
|------|----------------|
| `crates/handshaker-core/src/grpc/invoke/schema.rs` | `MessageSide` + `side` param on the builder |
| `src-tauri/src/ipc/schema.rs` | `MessageSideIpc` (specta) + conversion |
| `src-tauri/src/commands/grpc.rs` | `side` param on the `grpc_message_schema` command |
| `src/ipc/client.ts`, `src/features/workflow/actions.ts` | thread `side` through the safe fetch |
| `src/features/workflow/useMessageSchema.ts` | `side` in the hook signature + cache key |
| `src/lib/use-prefs.ts` | `bodyHints: boolean` pref (default `true`) |
| `src/features/bodyview/hints.ts` (**new**) | pure `computeInlayHints` + the Monaco inlay-hints provider |
| `src/features/bodyview/ghost.ts` (**new**) | pure `computeGhostLines` + `GhostZone` view-zone manager |
| `src/features/bodyview/completion.ts` | export `getModelSchema` (read access to the model↔schema WeakMap) |
| `src/features/bodyview/BodyView.tsx` | inlayHints option from pref · ghost zone lifecycle · response-mode schema attach |
| `src/lib/monaco.ts` | register the inlay provider · `editorInlayHint.*` theme colors |
| `src/features/workflow/RequestTabs.tsx` | hints + contract toggle buttons in the tab strip |
| `src/features/contract/tree.ts` (**new**) | pure row derivation (expansion, oneof groups, recursion guard) |
| `src/features/contract/ContractTree.tsx` (**new**) | tree rendering over `deriveRows` |
| `src/features/contract/ContractPanel.tsx` (**new**) | floating panel: header, Request/Response tabs, Esc/✕ |
| `src/features/workflow/CallPanel.tsx` | fetch both sides · `contractOpen` state · render panel |
| `src/features/response/ResponsePanel.tsx`, `ResponseBody.tsx` | thread `outputSchema` to the response BodyView |
| `src/styles/globals.css` | `.hs-ghost-skeleton` styling |

Existing pure helpers reused (do not modify): `parseWithSpans` (`parse.ts`), `descendSchema`/`setModelSchema` (`completion.ts`), `UnderlineTabs`.

---

## Phase A — backend `side` param + fetch layer

### Task 1: Core `MessageSide` + `side` param on the schema builder

**Files:**
- Modify: `crates/handshaker-core/src/grpc/invoke/schema.rs`
- Modify: the `MessageSchema` re-export site — grep `MessageSchema` in `crates/handshaker-core/src/grpc/invoke/mod.rs` (and `grpc/mod.rs` if names are listed explicitly) and add `MessageSide` alongside it.

- [x] **Step 1: Write the failing test** — in the `#[cfg(test)] mod tests` of `schema.rs`, using the existing `field`/`file`/`pool_with` helpers:

```rust
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
```

- [x] **Step 2: Run it** — `cargo test -p handshaker-core side_selects`
Expected: compile FAIL (`MessageSide` not found / wrong arg count).

- [x] **Step 3: Implement.** In `schema.rs`, below `FieldValueKind`:

```rust
/// Which side of a method the schema is built from.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MessageSide {
    Input,
    Output,
}
```

Change the builder (doc comment too — it no longer reads "input message"):

```rust
/// Build a flat schema for the given method's input or output message from a
/// descriptor pool.
pub fn build_message_schema_from_pool(
    pool: &DescriptorPool,
    service: &str,
    method: &str,
    side: MessageSide,
) -> Result<MessageSchema, CoreError> {
    // ... svc/m resolution unchanged ...
    Ok(build_schema(&match side {
        MessageSide::Input => m.input(),
        MessageSide::Output => m.output(),
    }))
}
```

Update the module doc header (`//! Flat field-schema for a method's input message`) → `//! Flat field-schema for a method's input or output message`. Update the existing test that calls `build_message_schema_from_pool(&pool, "t.Svc", "Call")` (and its `ServiceNotFound`/`MethodNotFound` asserts) to pass `MessageSide::Input`. Add `MessageSide` to the re-export site(s) found above.

- [x] **Step 4: Run** — `cargo test -p handshaker-core`
Expected: all green (incl. the new test and the updated old ones). ✅ 124 passed, commit `124bda3`.

- [x] **Step 5: Commit**

```bash
git add crates/handshaker-core
git commit -m "feat(core): MessageSide param on build_message_schema_from_pool

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

### Task 2: IPC `side` param end-to-end (command + bindings + safe fetch)

**Files:**
- Modify: `src-tauri/src/ipc/schema.rs`
- Modify: `src-tauri/src/commands/grpc.rs` (`grpc_message_schema`, ~line 105)
- Regenerate: `src/ipc/bindings.ts`
- Modify: `src/ipc/client.ts` (`grpcMessageSchema`, ~line 52)
- Modify: `src/features/workflow/actions.ts` (`fetchMessageSchemaSafe`, ~line 67)
- Test: `src/features/workflow/actions.test.ts` (extend the existing `fetchMessageSchemaSafe` describe)

- [x] **Step 1: Rust IPC enum + failing unit test.** In `src-tauri/src/ipc/schema.rs` add (plus `use handshaker_core::grpc::MessageSide;` to the imports):

```rust
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
```

And in its `mod tests`:

```rust
#[test]
fn side_converts_to_core() {
    assert!(matches!(MessageSide::from(MessageSideIpc::Input), MessageSide::Input));
    assert!(matches!(MessageSide::from(MessageSideIpc::Output), MessageSide::Output));
}
```

- [x] **Step 2: Command param.** In `src-tauri/src/commands/grpc.rs`, add `MessageSideIpc` to the existing `use crate::ipc::schema::{...}` list and change the command (doc comment: "input message" → "input or output message — drives autocomplete and the contract view"):

```rust
pub async fn grpc_message_schema(
    state: State<'_, AppState>,
    target: GrpcTargetIpc,
    service: String,
    method: String,
    side: MessageSideIpc,
) -> Result<MessageSchemaIpc, IpcError> {
    // both branches:
    // build_message_schema_from_pool(&..., &service, &method, side.into())?.into()
```

- [x] **Step 3: Run** — `cargo test -p handshaker`
Expected: green (conversion test passes, command compiles).

- [x] **Step 4: Regenerate bindings** — `cargo run -p handshaker --bin export-bindings --features export-bindings --quiet`
Then confirm: `grep -n "side" src/ipc/bindings.ts` shows `grpcMessageSchema(..., side: MessageSideIpc)` and `export type MessageSideIpc = "input" | "output"`.

- [x] **Step 5: Thread through the TS fetch layer.** `src/ipc/client.ts` (add `MessageSideIpc` to the type imports from `./bindings`):

```ts
export async function grpcMessageSchema(
  target: GrpcTargetIpc,
  service: string,
  method: string,
  side: MessageSideIpc,
): Promise<MessageSchemaIpc> {
  const r = await commands.grpcMessageSchema(target, service, method, side);
  if (r.status === "error") throw r.error;
  return r.data;
}
```

`src/features/workflow/actions.ts` (default keeps current callers' behavior; add `MessageSideIpc` to its bindings type imports):

```ts
export async function fetchMessageSchemaSafe(
  target: CallTargetInit,
  service: string,
  method: string,
  side: MessageSideIpc = "input",
): Promise<MessageSchemaIpc | null> {
  try {
    const address = await resolveAddressSafe(target.address);
    return await ipc.grpcMessageSchema({ address, tls: target.tls, skip_verify: false }, service, method, side);
  } catch {
    return null;
  }
}
```

- [x] **Step 6: Extend the actions test.** *(deviation, justified: файл не имел существующего `fetchMessageSchemaSafe`-describe — создан новый с моком `grpcMessageSchema` в фабрике, 3 теста.)* In `src/features/workflow/actions.test.ts`, inside the existing `fetchMessageSchemaSafe` describe (reuse its existing `ipc`/`grpcMessageSchema` mock — follow the file's established mock shape):

```ts
it("forwards the requested side to the IPC call", async () => {
  await fetchMessageSchemaSafe({ address: "h", tls: false }, "S", "M", "output");
  expect(/* the file's grpcMessageSchema mock */).toHaveBeenCalledWith(
    expect.objectContaining({ tls: false }),
    "S",
    "M",
    "output",
  );
});
```

Also check whether existing `fetchMessageSchemaSafe` assertions pin the exact call args — if they do, append `"input"` (the default) to their expected arg lists.

- [x] **Step 7: Run** — `pnpm test src/features/workflow/actions.test.ts && pnpm lint`
Expected: green. (`useMessageSchema` still compiles — it relies on the default `side`.) ✅ cargo 43 / FE 684 / lint clean, commit `8994acc` (включая doc-tail фикс `schema.rs` из ревью Task 1).

- [x] **Step 8: Commit**

```bash
git add src-tauri src/ipc/bindings.ts src/ipc/client.ts src/features/workflow/actions.ts src/features/workflow/actions.test.ts
git commit -m "feat(ipc): side param on grpc_message_schema (input|output)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

### Task 3: `useMessageSchema(target, side)` — side in the cache key

**Files:**
- Modify: `src/features/workflow/useMessageSchema.ts`
- Test: `src/features/workflow/useMessageSchema.test.ts`

- [x] **Step 1: Write the failing test** (append to the existing describe; pick a fresh address so the module-level cache from earlier tests can't collide):

```ts
const OUT: MessageSchemaIpc = { root: "t.Out", messages: [], enums: [] };

it("caches input and output sides separately", async () => {
  fetchMock.mockResolvedValueOnce(SCHEMA).mockResolvedValueOnce(OUT);
  const target = { address: "sides-host", tls: false, service: "S", method: "M" };

  const a = renderHook(() => useMessageSchema(target, "input"));
  await waitFor(() => expect(a.result.current).toEqual(SCHEMA));

  const b = renderHook(() => useMessageSchema(target, "output"));
  await waitFor(() => expect(b.result.current).toEqual(OUT));

  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(fetchMock).toHaveBeenLastCalledWith(
    { address: "sides-host", tls: false }, "S", "M", "output",
  );
});
```

- [x] **Step 2: Run** — `pnpm test src/features/workflow/useMessageSchema.test.ts`
Expected: FAIL (hook takes one argument / both renders share one cache entry).

- [x] **Step 3: Implement** — in `useMessageSchema.ts` (import `MessageSideIpc` type from `@/ipc/bindings`):

```ts
/** Process-wide cache keyed by address|tls|service|method|side. Holds null results too. */
export function useMessageSchema(
  target: SchemaTarget,
  side: MessageSideIpc = "input",
): MessageSchemaIpc | null {
  const { address, tls, service, method } = target;
  const key = `${address}|${tls}|${service}|${method}|${side}`;
  // ... unchanged, except the fetch call and the effect deps:
  void fetchMessageSchemaSafe({ address, tls }, service, method, side).then(...)
  }, [key, address, tls, service, method, side]);
```

- [x] **Step 4: Run** — `pnpm test src/features/workflow/useMessageSchema.test.ts && pnpm lint`
Expected: green (existing tests pass via the `"input"` default). ✅ 3/3 + lint clean, commit `cea3c57`.

- [x] **Step 5: Commit**

```bash
git add src/features/workflow/useMessageSchema.ts src/features/workflow/useMessageSchema.test.ts
git commit -m "feat(workflow): useMessageSchema takes a side (input|output)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

🧹 **/clear-чекпойнт** — Phase A done (backend + fetch layer green).

---

## Phase B — inline hints + ghost skeleton

### Task 4: `bodyHints` pref

**Files:**
- Modify: `src/lib/use-prefs.ts`
- Test: `src/lib/use-prefs.test.ts`

- [x] **Step 1: Failing test** (append to the existing suite, mirroring how other defaults are asserted there):

```ts
it("defaults bodyHints to true", () => {
  expect(PREFS_DEFAULTS.bodyHints).toBe(true);
});
```

- [x] **Step 2: Run** — `pnpm test src/lib/use-prefs.test.ts` — expected FAIL (property missing).

- [x] **Step 3: Implement** — in `Prefs` add:

```ts
  /** Inline contract hints in body editors: inlay type labels + the ghost skeleton. */
  bodyHints: boolean;
```

and `bodyHints: true,` in `PREFS_DEFAULTS`.

- [x] **Step 4: Run** — `pnpm test src/lib/use-prefs.test.ts && pnpm lint` — green. ✅ 14/14 + lint,
commits `3420a9f` + `098c171` (merge-тест `bodyHints:false` добавлен по ревью).

- [x] **Step 5: Commit**

```bash
git add src/lib/use-prefs.ts src/lib/use-prefs.test.ts
git commit -m "feat(prefs): bodyHints pref (default on)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

### Task 5: pure `computeInlayHints` (+ `getModelSchema` export)

**Files:**
- Create: `src/features/bodyview/hints.ts`
- Modify: `src/features/bodyview/completion.ts` (one new export)
- Test: `src/features/bodyview/hints.test.ts`

- [x] **Step 1: Failing tests** — `src/features/bodyview/hints.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import type { MessageSchemaIpc, FieldNodeIpc } from "@/ipc/bindings";
import { computeInlayHints } from "./hints";

function f(json: string, label: string, kind: FieldNodeIpc["value_kind"], extra: Partial<FieldNodeIpc> = {}): FieldNodeIpc {
  return {
    json_name: json, proto_name: json, type_label: label, value_kind: kind,
    repeated: false, message_type: null, enum_type: null, oneof_group: null, ...extra,
  };
}

const SCHEMA: MessageSchemaIpc = {
  root: "t.Req",
  messages: [
    {
      full_name: "t.Req",
      fields: [
        f("query", "string", "scalar"),
        f("sort", "SortDir", "enum", { enum_type: "t.SortDir" }),
        f("filters", "Filter", "message", { message_type: "t.Filter" }),
        f("attrs", "map<string, string>", "map"),
        f("items", "repeated Item", "message", { repeated: true, message_type: "t.Item" }),
        f("mood", "Mood", "enum", { enum_type: "t.Mood" }),
      ],
    },
    { full_name: "t.Filter", fields: [f("tags", "repeated string", "scalar", { repeated: true })] },
    { full_name: "t.Item", fields: [f("name", "string", "scalar")] },
  ],
  enums: [
    { full_name: "t.SortDir", values: ["ASC", "DESC"] },
    { full_name: "t.Mood", values: ["A", "B", "C", "D", "E", "F"] },
  ],
};

describe("computeInlayHints", () => {
  it("annotates a scalar value right after its token", () => {
    const text = '{ "query": "alice" }';
    const hints = computeInlayHints(text, SCHEMA);
    expect(hints).toEqual([{ offset: text.indexOf('"alice"') + '"alice"'.length, label: "string" }]);
  });

  it("annotates composite values after the opening brace", () => {
    const text = '{ "filters": { "tags": ["x"] } }';
    const hints = computeInlayHints(text, SCHEMA);
    const open = text.indexOf("{", text.indexOf("filters"));
    expect(hints).toContainEqual({ offset: open + 1, label: "Filter" });
    // nested key resolved through the schema:
    const arr = text.indexOf("[");
    expect(hints).toContainEqual({ offset: arr + 1, label: "repeated string" });
  });

  it("expands enum values in the label (≤5 shown in full)", () => {
    const hints = computeInlayHints('{ "sort": "ASC" }', SCHEMA);
    expect(hints[0].label).toBe("enum SortDir: ASC | DESC");
  });

  it("truncates enum previews past 5 values", () => {
    const hints = computeInlayHints('{ "mood": "A" }', SCHEMA);
    expect(hints[0].label).toBe("enum Mood: A | B | C | D | E | …");
  });

  it("labels the map field itself but skips arbitrary map-entry keys", () => {
    const text = '{ "attrs": { "k1": "v" } }';
    const hints = computeInlayHints(text, SCHEMA);
    expect(hints).toHaveLength(1);
    expect(hints[0].label).toBe("map<string, string>");
  });

  it("resolves keys inside repeated-message array elements", () => {
    const text = '{ "items": [ { "name": "x" } ] }';
    const labels = computeInlayHints(text, SCHEMA).map((h) => h.label);
    expect(labels).toContain("repeated Item");
    expect(labels).toContain("string");
  });

  it("returns [] for invalid JSON and for unknown keys", () => {
    expect(computeInlayHints('{ "query": ', SCHEMA)).toEqual([]);
    expect(computeInlayHints('{ "nope": 1 }', SCHEMA)).toEqual([]);
  });
});
```

- [x] **Step 2: Run** — `pnpm test src/features/bodyview/hints.test.ts` — FAIL (module missing).

- [x] **Step 3: Implement** — `src/features/bodyview/hints.ts` (pure part only; the provider comes in Task 6):

```ts
import type { MessageSchemaIpc, FieldNodeIpc } from "@/ipc/bindings";
import { parseWithSpans } from "./parse";
import { descendSchema } from "./completion";
import type { JsonNode, JsonTree } from "./jsonTree";

export interface InlayHintItem {
  /** 0-based source offset the hint anchors AFTER (caller converts to a position). */
  offset: number;
  label: string;
}

const ENUM_PREVIEW_MAX = 5;

function hintLabel(schema: MessageSchemaIpc, field: FieldNodeIpc): string {
  if (field.value_kind === "enum" && field.enum_type) {
    const en = schema.enums.find((e) => e.full_name === field.enum_type);
    if (en) {
      const head = en.values.slice(0, ENUM_PREVIEW_MAX).join(" | ");
      const tail = en.values.length > ENUM_PREVIEW_MAX ? " | …" : "";
      const short = field.enum_type.split(".").pop() ?? field.enum_type;
      return `${field.repeated ? "repeated enum" : "enum"} ${short}: ${head}${tail}`;
    }
  }
  return field.type_label;
}

/** Object keys from root to the node's ENCLOSING object (array hops add nothing) —
 *  the same path convention `descendSchema` expects. */
function pathTo(tree: JsonTree, node: JsonNode): string[] {
  const segs: string[] = [];
  let cur = node.parentId ? tree.nodes[node.parentId] : null;
  while (cur) {
    if (cur.key !== null) segs.unshift(cur.key);
    cur = cur.parentId ? tree.nodes[cur.parentId] : null;
  }
  return segs;
}

/** One hint per recognized object key: type label anchored after the value's first
 *  token (after `{`/`[` for composites, after the whole token for scalars). */
export function computeInlayHints(text: string, schema: MessageSchemaIpc): InlayHintItem[] {
  const parsed = parseWithSpans(text);
  if (!parsed) return [];
  const spanByNode = new Map(parsed.spans.map((s) => [s.nodeId, s]));
  const out: InlayHintItem[] = [];
  for (const id of parsed.tree.order) {
    const node = parsed.tree.nodes[id];
    if (node.key === null) continue; // root / array elements
    const d = descendSchema(schema, pathTo(parsed.tree, node));
    if (!d || d.kind === "map") continue; // unknown path, or arbitrary map-entry keys
    const field = d.node.fields.find((fl) => fl.json_name === node.key);
    if (!field) continue;
    const span = spanByNode.get(id);
    if (!span) continue;
    const offset =
      node.kind === "object" || node.kind === "array" ? span.start + 1 : span.end;
    out.push({ offset, label: hintLabel(schema, field) });
  }
  out.sort((a, b) => a.offset - b.offset);
  return out;
}
```

In `completion.ts`, below `setModelSchema`, add:

```ts
/** Read access for sibling providers (inlay hints) sharing the same model↔schema map. */
export function getModelSchema(
  model: Monaco.editor.ITextModel,
): MessageSchemaIpc | undefined {
  return schemaByModel.get(model);
}
```

- [x] **Step 4: Run** — `pnpm test src/features/bodyview/hints.test.ts && pnpm lint` — green.
✅ 8 тестов (7 плановых + repeated-enum по ревью) + lint, commits `f74ca80` + `2f4affd`.

- [x] **Step 5: Commit**

```bash
git add src/features/bodyview/hints.ts src/features/bodyview/hints.test.ts src/features/bodyview/completion.ts
git commit -m "feat(bodyview): pure inlay-hint computation from the message schema

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

### Task 6: inlay-hints provider + registration + editor option + theme colors

**Files:**
- Modify: `src/features/bodyview/hints.ts` (provider + refresh emitter)
- Modify: `src/lib/monaco.ts` (register provider; `editorInlayHint.*` colors in both themes)
- Modify: `src/features/bodyview/BodyView.tsx` (options memo from pref; refresh on schema change)
- Test: `src/features/bodyview/hints.test.ts` (provider describe)

- [x] **Step 1: Failing provider test** — append to `hints.test.ts`:

```ts
import { registerBodyInlayHints } from "./hints";
import { setModelSchema } from "./completion";

function fakeModel(text: string) {
  return {
    getValue: () => text,
    getPositionAt(offset: number) {
      let line = 1, col = 1;
      for (let i = 0; i < offset && i < text.length; i++) {
        if (text[i] === "\n") { line++; col = 1; } else col++;
      }
      return { lineNumber: line, column: col };
    },
  };
}

describe("registerBodyInlayHints", () => {
  it("serves hints for models with an attached schema, none otherwise", () => {
    const providers: any[] = [];
    const fakeMonaco = {
      Emitter: class { event = () => ({ dispose() {} }); fire() {} },
      languages: {
        registerInlayHintsProvider: (lang: string, p: unknown) => {
          expect(lang).toBe("json-with-vars");
          providers.push(p);
        },
        InlayHintKind: { Type: 1 },
      },
    };
    registerBodyInlayHints(fakeMonaco as never);
    expect(providers).toHaveLength(1);

    const model = fakeModel('{ "query": "x" }');
    expect(providers[0].provideInlayHints(model).hints).toEqual([]);

    setModelSchema(model as never, SCHEMA);
    const res = providers[0].provideInlayHints(model);
    expect(res.hints).toHaveLength(1);
    expect(res.hints[0].label).toBe("string");
    expect(res.hints[0].paddingLeft).toBe(true);
    expect(res.hints[0].position.lineNumber).toBe(1);
    setModelSchema(model as never, null);
  });
});
```

- [x] **Step 2: Run** — `pnpm test src/features/bodyview/hints.test.ts` — FAIL (no `registerBodyInlayHints`).

- [x] **Step 3: Implement the provider** — append to `hints.ts`:

```ts
import type * as Monaco from "monaco-editor";
import { getModelSchema } from "./completion";

let fireHintsChanged: (() => void) | null = null;

/** Nudge Monaco to re-query inlay hints (schema attached/changed on some model).
 *  Plain content edits already refresh hints natively; this covers schema swaps
 *  (method change, late fetch) — the monaco#4700 programmatic-update gotcha. */
export function refreshBodyHints(): void {
  fireHintsChanged?.();
}

/** Register the inlay-hints provider exactly once (called from monaco.ts setup). */
export function registerBodyInlayHints(monaco: typeof Monaco): void {
  const emitter = new monaco.Emitter<void>();
  fireHintsChanged = () => emitter.fire();
  monaco.languages.registerInlayHintsProvider("json-with-vars", {
    onDidChangeInlayHints: emitter.event,
    provideInlayHints(model) {
      const schema = getModelSchema(model);
      if (!schema) return { hints: [], dispose: () => {} };
      const hints = computeInlayHints(model.getValue(), schema).map((h) => ({
        position: model.getPositionAt(h.offset),
        label: h.label,
        kind: monaco.languages.InlayHintKind.Type,
        paddingLeft: true,
      }));
      return { hints, dispose: () => {} };
    },
  });
}
```

(Adjust the top-of-file imports: `hints.ts` now needs both the type-only `Monaco` import and `getModelSchema` — merge with the existing import lines.)

- [x] **Step 4: Register + theme colors.** In `src/lib/monaco.ts`:
  - `import { registerBodyInlayHints } from "@/features/bodyview/hints";`
  - after `registerBodyCompletion(monaco);` add `registerBodyInlayHints(monaco);`
  - in the `handshaker-dark` theme `colors` add:
    `"editorInlayHint.foreground": "#8C8C8C", "editorInlayHint.background": "#1A1A1A",`
  - in `handshaker-light`: `"editorInlayHint.foreground": "#8C8C8C", "editorInlayHint.background": "#F2F2F2",`

- [x] **Step 5: Wire the pref + schema refresh in `BodyView.tsx`:**
  - replace `const options = mode === "response" ? BODY_READONLY_OPTIONS : BODY_EDIT_OPTIONS;` with:

```ts
const options = useMemo(
  () => ({
    ...(mode === "response" ? BODY_READONLY_OPTIONS : BODY_EDIT_OPTIONS),
    inlayHints: { enabled: prefs.bodyHints ? ("on" as const) : ("off" as const) },
  }),
  [mode, prefs.bodyHints],
);
```

  - in the schema-sync effect (`useEffect(..., [schema, mode])`), after `setModelSchema(model ?? null, schema ?? null);` add `refreshBodyHints();` (import from `./hints`).

- [x] **Step 6: Run** — `pnpm test src/features/bodyview && pnpm lint`
Expected: all bodyview suites green (existing BodyView tests unaffected — options shape only gained a key).
✅ 74/74 bodyview + 696 full + lint, commits `5d47b51` + `2b0a2ba` (HMR-guard перерегистрации по ревью).

- [x] **Step 7: Commit**

```bash
git add src/features/bodyview/hints.ts src/features/bodyview/hints.test.ts src/lib/monaco.ts src/features/bodyview/BodyView.tsx
git commit -m "feat(bodyview): inlay type hints on json-with-vars, toggled by bodyHints

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

### Task 7: pure `computeGhostLines` + `GhostZone` view-zone manager

**Files:**
- Create: `src/features/bodyview/ghost.ts`
- Test: `src/features/bodyview/ghost.test.ts`

- [x] **Step 1: Failing tests** — `src/features/bodyview/ghost.test.ts` (reuse the `f(...)`/SCHEMA fixture shape from `hints.test.ts` — copy the factory locally; fixtures stay file-local by convention here):

```ts
import { describe, it, expect } from "vitest";
import type { MessageSchemaIpc, FieldNodeIpc } from "@/ipc/bindings";
import { computeGhostLines, GhostZone, ghostDomNode } from "./ghost";

function f(json: string, label: string, kind: FieldNodeIpc["value_kind"], extra: Partial<FieldNodeIpc> = {}): FieldNodeIpc {
  return {
    json_name: json, proto_name: json, type_label: label, value_kind: kind,
    repeated: false, message_type: null, enum_type: null, oneof_group: null, ...extra,
  };
}

const SCHEMA: MessageSchemaIpc = {
  root: "t.Req",
  messages: [
    { full_name: "t.Req", fields: [f("query", "string", "scalar"), f("deadline", "Timestamp", "message", { message_type: "g.Timestamp" })] },
    { full_name: "g.Timestamp", fields: [] },
  ],
  enums: [],
};

describe("computeGhostLines", () => {
  it("lists missing top-level fields above the closing brace", () => {
    const block = computeGhostLines('{\n  "query": "x"\n}', SCHEMA);
    expect(block).toEqual({ afterLine: 2, lines: ['  "deadline": Timestamp'] });
  });

  it("returns null when every field is present", () => {
    expect(computeGhostLines('{\n  "query": "x",\n  "deadline": {}\n}', SCHEMA)).toBeNull();
  });

  it("anchors after the opening brace for an empty object", () => {
    expect(computeGhostLines("{}", SCHEMA)).toEqual({
      afterLine: 1,
      lines: ['  "query": string', '  "deadline": Timestamp'],
    });
  });

  it("returns null for invalid JSON, a non-object root, and an unknown schema root", () => {
    expect(computeGhostLines('{ "query": ', SCHEMA)).toBeNull();
    expect(computeGhostLines("[1]", SCHEMA)).toBeNull();
    expect(computeGhostLines("{}", { root: "t.Nope", messages: [], enums: [] })).toBeNull();
  });
});

describe("GhostZone", () => {
  function fakeZoneEditor() {
    const zones = new Map<string, { afterLineNumber: number; heightInLines: number; domNode: HTMLElement }>();
    let n = 0;
    return {
      zones,
      changeViewZones(cb: (acc: { addZone(z: never): string; removeZone(id: string): void }) => void) {
        cb({
          addZone: (z: never) => { const id = `z${n++}`; zones.set(id, z); return id; },
          removeZone: (id: string) => { zones.delete(id); },
        } as never);
      },
    };
  }

  it("adds, replaces and removes the single zone", () => {
    const ed = fakeZoneEditor();
    const gz = new GhostZone(ed);
    gz.apply({ afterLine: 2, lines: ["a", "b"] }, 40);
    expect(ed.zones.size).toBe(1);
    const z = [...ed.zones.values()][0];
    expect(z.afterLineNumber).toBe(2);
    expect(z.heightInLines).toBe(2);
    expect(z.domNode.style.paddingLeft).toBe("40px");

    gz.apply({ afterLine: 1, lines: ["c"] });
    expect(ed.zones.size).toBe(1);
    expect([...ed.zones.values()][0].afterLineNumber).toBe(1);

    gz.apply(null);
    expect(ed.zones.size).toBe(0);
    gz.dispose(); // idempotent
    expect(ed.zones.size).toBe(0);
  });

  it("renders one div per ghost line via textContent (no HTML injection)", () => {
    const node = ghostDomNode(['  "a <b>": X']);
    expect(node.className).toBe("hs-ghost-skeleton");
    expect(node.children).toHaveLength(1);
    expect(node.children[0].textContent).toBe('  "a <b>": X');
    expect(node.innerHTML).not.toContain("<b>");
  });
});
```

- [x] **Step 2: Run** — `pnpm test src/features/bodyview/ghost.test.ts` — FAIL (module missing).

- [x] **Step 3: Implement** — `src/features/bodyview/ghost.ts`:

```ts
import type { MessageSchemaIpc } from "@/ipc/bindings";
import { parseWithSpans } from "./parse";

export interface GhostBlock {
  /** 1-based line the zone is inserted AFTER (the last top-level entry / the `{`). */
  afterLine: number;
  /** Rendered ghost lines, already indented: `  "jsonName": TypeLabel`. */
  lines: string[];
}

function lineOfOffset(text: string, offset: number): number {
  let line = 1;
  for (let i = 0; i < offset && i < text.length; i++) if (text[i] === "\n") line++;
  return line;
}

/** Top-level diff: root-message fields minus keys present at depth 1. Null when
 *  the body is unparseable, the root isn't an object, or nothing is missing. */
export function computeGhostLines(text: string, schema: MessageSchemaIpc): GhostBlock | null {
  const parsed = parseWithSpans(text);
  if (!parsed || parsed.tree.rootId === null) return null;
  const root = parsed.tree.nodes[parsed.tree.rootId];
  if (root.kind !== "object") return null;
  const rootMsg = schema.messages.find((m) => m.full_name === schema.root);
  if (!rootMsg) return null;

  const present = new Set(root.childIds.map((id) => parsed.tree.nodes[id].key));
  const missing = rootMsg.fields.filter((fl) => !present.has(fl.json_name));
  if (missing.length === 0) return null;

  const spanByNode = new Map(parsed.spans.map((s) => [s.nodeId, s]));
  const lastChild = root.childIds[root.childIds.length - 1];
  const anchorOffset = lastChild
    ? spanByNode.get(lastChild)!.end
    : spanByNode.get(root.id)!.start + 1;
  return {
    afterLine: lineOfOffset(text, anchorOffset),
    lines: missing.map((fl) => `  "${fl.json_name}": ${fl.type_label}`),
  };
}

// --- Monaco glue (structurally typed so tests need no real editor) -----------

interface ViewZoneAccessorLike {
  addZone(zone: {
    afterLineNumber: number;
    heightInLines: number;
    domNode: HTMLElement;
    suppressMouseDown?: boolean;
  }): string;
  removeZone(id: string): void;
}

export interface ViewZoneEditorLike {
  changeViewZones(cb: (accessor: ViewZoneAccessorLike) => void): void;
}

export function ghostDomNode(lines: string[]): HTMLElement {
  const node = document.createElement("div");
  node.className = "hs-ghost-skeleton";
  for (const l of lines) {
    const row = document.createElement("div");
    row.textContent = l;
    node.appendChild(row);
  }
  return node;
}

/** Owns at most ONE view zone on an editor; `apply(null)` removes it. */
export class GhostZone {
  private zoneId: string | null = null;
  constructor(private readonly editor: ViewZoneEditorLike) {}

  apply(block: GhostBlock | null, contentLeft = 0): void {
    this.editor.changeViewZones((acc) => {
      if (this.zoneId !== null) {
        acc.removeZone(this.zoneId);
        this.zoneId = null;
      }
      if (!block) return;
      const node = ghostDomNode(block.lines);
      node.style.paddingLeft = `${contentLeft}px`;
      this.zoneId = acc.addZone({
        afterLineNumber: block.afterLine,
        heightInLines: block.lines.length,
        domNode: node,
        suppressMouseDown: true,
      });
    });
  }

  dispose(): void {
    this.apply(null);
  }
}
```

- [x] **Step 4: Run** — `pnpm test src/features/bodyview/ghost.test.ts && pnpm lint` — green.
✅ 7 тестов (+multi-line-anchor по ревью), commits `7328ad7` + `7eb4bdc`.

- [x] **Step 5: Commit**

```bash
git add src/features/bodyview/ghost.ts src/features/bodyview/ghost.test.ts
git commit -m "feat(bodyview): top-level ghost-skeleton computation + view-zone manager

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

### Task 8: wire the ghost zone into `BodyView` (request mode)

**Files:**
- Modify: `src/features/bodyview/BodyView.tsx`
- Modify: `src/styles/globals.css` (locate it via `ls src/styles/` — the project's global stylesheet referenced in CLAUDE.md; if it lives elsewhere, `grep -r "hs-tab-progress" src` finds it)

No new unit test: the pure core and zone manager are covered by Task 7; this task is thin imperative glue verified by the existing BodyView suites staying green + the live pass (Task 14).

- [x] **Step 1: Extend the `Live` struct** in `BodyView.tsx`:

```ts
import { GhostZone, computeGhostLines } from "./ghost";
import { readPrefs } from "@/lib/use-prefs";   // merge with the existing use-prefs import

interface Live {
  // ... existing fields ...
  ghost: GhostZone | null;
  ghostTimer: number | null;
}
```

(Initialize `ghost: null, ghostTimer: null` in the `live.current = {...}` literal in `onMount`.)

- [x] **Step 2: Add the scheduler** (inside the component, above `onMount`):

```ts
// Recompute the ghost skeleton; debounced so per-keystroke edits don't churn zones.
const scheduleGhost = useCallback((delay: number) => {
  const l = live.current;
  if (!l || !l.ghost) return;
  if (l.ghostTimer !== null) window.clearTimeout(l.ghostTimer);
  l.ghostTimer = window.setTimeout(() => {
    l.ghostTimer = null;
    const sc = schemaRef.current;
    const block =
      readPrefs().bodyHints && sc ? computeGhostLines(l.editor.getValue(), sc) : null;
    l.ghost?.apply(block, l.editor.getLayoutInfo().contentLeft);
  }, delay);
}, []);
```

- [x] **Step 3: Hook it up:**
  - in `onMount`, inside the `if (mode === "request")` branch: `live.current.ghost = new GhostZone(editor); scheduleGhost(0);`
  - in `handleChange`, inside the `if (mode === "request" && live.current)` branch: `scheduleGhost(150);`
  - in the schema-sync effect, after `refreshBodyHints();`: `scheduleGhost(0);`
  - new effect reacting to the toggle: `useEffect(() => { scheduleGhost(0); }, [prefs.bodyHints, scheduleGhost]);`
  - in the unmount cleanup effect (the one disposing controller/typeSub): add

```ts
if (live.current?.ghostTimer != null) window.clearTimeout(live.current.ghostTimer);
live.current?.ghost?.dispose();
```

- [x] **Step 4: Style** — append to the global stylesheet:

```css
/* Ghost skeleton of missing top-level request fields (BodyView view zone). */
.hs-ghost-skeleton {
  font-style: italic;
  opacity: 0.45;
  white-space: pre;
  pointer-events: none;
}
```

- [x] **Step 5: Run** — `pnpm test src/features/bodyview && pnpm lint && pnpm test`
Expected: full suite green (no behavior change for response mode; request mode adds zones only when a schema is attached).
✅ 703/703 + lint, commits `6561918` + `715bdeb` (ghost-teardown в onMount по ревью; 2 BodyView-тест-мока
дополнены `changeViewZones`/`getLayoutInfo`/`readPrefs` — только mock-completeness, без изменения assertion'ов).

- [x] **Step 6: Commit**

```bash
git add src/features/bodyview/BodyView.tsx src/styles/globals.css
git commit -m "feat(bodyview): ghost-skeleton view zone in the request editor

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

🧹 **/clear-чекпойнт** — Phase B done (inline hints + ghost, both behind `bodyHints`).

---

## Phase C — contract overlay UI

### Task 9: toggle buttons in the Request tab strip

**Files:**
- Modify: `src/features/workflow/RequestTabs.tsx`
- Test: `src/features/workflow/RequestTabs.test.tsx`

- [x] **Step 1: Failing tests.** First refactor the test file minimally: add a render helper and use it everywhere (the new always-visible hints button needs `TooltipProvider`, which several existing cases don't provide):

```tsx
function renderTabs(ui: React.ReactElement) {
  return render(<TooltipProvider>{ui}</TooltipProvider>);
}
```

(Replace each bare `render(<RequestTabs ... />)` / explicit `TooltipProvider` wrap with `renderTabs(...)`.) Then append:

```tsx
describe("RequestTabs contract toggles", () => {
  it("toggles the bodyHints pref via the hints button", async () => {
    const user = userEvent.setup();
    renderTabs(<RequestTabs {...setup()} />);
    const btn = screen.getByRole("button", { name: /inline type hints/i });
    const initial = btn.getAttribute("aria-pressed");
    await user.click(btn);
    expect(btn).toHaveAttribute("aria-pressed", initial === "true" ? "false" : "true");
    await user.click(btn); // restore module-level prefs state for sibling tests
    expect(btn).toHaveAttribute("aria-pressed", initial);
  });

  it("shows the contract button only when onToggleContract is provided, and reports pressed state", async () => {
    const user = userEvent.setup();
    const onToggleContract = vi.fn();
    const { unmount } = renderTabs(<RequestTabs {...setup()} />);
    expect(screen.queryByRole("button", { name: /method contract/i })).toBeNull();
    unmount();

    renderTabs(<RequestTabs {...setup()} contractOpen onToggleContract={onToggleContract} />);
    const btn = screen.getByRole("button", { name: /method contract/i });
    expect(btn).toHaveAttribute("aria-pressed", "true");
    await user.click(btn);
    expect(onToggleContract).toHaveBeenCalledTimes(1);
  });

  it("hides both toggles off the Request tab", async () => {
    const user = userEvent.setup();
    renderTabs(<RequestTabs {...setup()} onToggleContract={vi.fn()} />);
    await user.click(screen.getByRole("tab", { name: /metadata/i }));
    expect(screen.queryByRole("button", { name: /inline type hints/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /method contract/i })).toBeNull();
  });

  it("disables the contract button when no method is selected", () => {
    const step = newStep({ address: "h", tls: false, service: "S", method: "", requestJson: "{}" });
    renderTabs(
      <RequestTabs step={step} serviceAuth={{ kind: "none" }} onBody={vi.fn()} onMetadata={vi.fn()} onToggleContract={vi.fn()} />,
    );
    expect(screen.getByRole("button", { name: /method contract/i })).toBeDisabled();
  });
});
```

- [x] **Step 2: Run** — `pnpm test src/features/workflow/RequestTabs.test.tsx` — FAIL (buttons missing).

- [x] **Step 3: Implement** in `RequestTabs.tsx`:
  - imports: `import { RotateCcw, Type, ListTree } from "lucide-react";` and `import { usePrefs } from "@/lib/use-prefs";`
  - props:

```ts
  /** Contract overlay toggle (editable draft only). Omit to hide the button. */
  contractOpen?: boolean;
  onToggleContract?: () => void;
```

  - inside the component: `const [prefs, setPref] = usePrefs();`
  - replace the `{tab === "request" && onResetTemplate ? (...) : null}` block with a right-aligned group (the Reset button moves inside unchanged, minus its `ml-auto`):

```tsx
{tab === "request" ? (
  <div className="ml-auto flex items-center gap-1">
    <Tooltip content="Inline type hints">
      <Button
        variant="ghost"
        size="icon-xs"
        onClick={() => setPref("bodyHints", !prefs.bodyHints)}
        aria-label="Toggle inline type hints"
        aria-pressed={prefs.bodyHints}
        className={prefs.bodyHints ? "text-foreground" : "text-muted-foreground hover:text-foreground"}
      >
        <Type />
      </Button>
    </Tooltip>
    {onToggleContract ? (
      <Tooltip content="Method contract">
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={onToggleContract}
          disabled={step.method.trim().length === 0}
          aria-label="Toggle method contract"
          aria-pressed={contractOpen ?? false}
          className={contractOpen ? "text-foreground" : "text-muted-foreground hover:text-foreground"}
        >
          <ListTree />
        </Button>
      </Tooltip>
    ) : null}
    {onResetTemplate ? (
      <Tooltip content="Reset body to template">
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={onResetTemplate}
          disabled={step.method.trim().length === 0}
          aria-label="Reset body to template"
          className="text-muted-foreground hover:text-foreground"
        >
          <RotateCcw />
        </Button>
      </Tooltip>
    ) : null}
  </div>
) : null}
```

  (Destructure the new props in the function signature.)

- [x] **Step 4: Run** — `pnpm test src/features/workflow/RequestTabs.test.tsx && pnpm lint` — green (incl. the pre-existing Reset cases via `renderTabs`). ✅ 13/13 + lint, commit `4109ce1`. (Code review: 2 «Important» nits — tooltip-on-disabled mirrors the pre-existing Reset button pattern → deferred as cross-cutting; real-pref round-trip test is deliberate per plan → kept.)

- [x] **Step 5: Commit**

```bash
git add src/features/workflow/RequestTabs.tsx src/features/workflow/RequestTabs.test.tsx
git commit -m "feat(workflow): hints + contract toggles in the Request tab strip

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

### Task 10: pure contract-tree row derivation

**Files:**
- Create: `src/features/contract/tree.ts`
- Test: `src/features/contract/tree.test.ts`

- [x] **Step 1: Failing tests** — `src/features/contract/tree.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import type { MessageSchemaIpc, FieldNodeIpc } from "@/ipc/bindings";
import { deriveRows, type ContractRow } from "./tree";

function f(json: string, label: string, kind: FieldNodeIpc["value_kind"], extra: Partial<FieldNodeIpc> = {}): FieldNodeIpc {
  return {
    json_name: json, proto_name: json, type_label: label, value_kind: kind,
    repeated: false, message_type: null, enum_type: null, oneof_group: null, ...extra,
  };
}

const SCHEMA: MessageSchemaIpc = {
  root: "t.Req",
  messages: [
    {
      full_name: "t.Req",
      fields: [
        f("query", "string", "scalar"),
        f("sort", "SortDir", "enum", { enum_type: "t.SortDir" }),
        f("filters", "Filter", "message", { message_type: "t.Filter" }),
        f("byId", "string", "scalar", { oneof_group: "selector" }),
        f("byName", "string", "scalar", { oneof_group: "selector" }),
      ],
    },
    {
      full_name: "t.Filter",
      // self-reference → recursion guard must stop expansion
      fields: [f("tags", "repeated string", "scalar", { repeated: true }), f("nested", "Filter", "message", { message_type: "t.Filter" })],
    },
  ],
  enums: [{ full_name: "t.SortDir", values: ["ASC", "DESC"] }],
};

type FieldRow = Extract<ContractRow, { kind: "field" }>;

describe("deriveRows", () => {
  it("emits root fields at depth 0 with enum values resolved", () => {
    const rows = deriveRows(SCHEMA, new Set());
    const fields = rows.filter((r): r is FieldRow => r.kind === "field");
    expect(fields.map((r) => r.field.json_name)).toEqual(["query", "sort", "filters", "byId", "byName"]);
    expect(fields[0].depth).toBe(0);
    expect(fields[1].enumValues).toEqual(["ASC", "DESC"]);
    expect(fields[2].expandable).toBe(true);
    expect(fields[2].expanded).toBe(false);
  });

  it("inserts a oneof header row before the group's first member", () => {
    const rows = deriveRows(SCHEMA, new Set());
    const i = rows.findIndex((r) => r.kind === "oneof");
    expect(i).toBeGreaterThan(-1);
    expect(rows[i]).toMatchObject({ kind: "oneof", label: "selector" });
    expect(rows[i + 1]).toMatchObject({ kind: "field", field: expect.objectContaining({ json_name: "byId" }) });
    // exactly one header for the two adjacent members
    expect(rows.filter((r) => r.kind === "oneof")).toHaveLength(1);
  });

  it("expands a message field one level when its path is in `expanded`", () => {
    const rows = deriveRows(SCHEMA, new Set(["/filters"]));
    const tags = rows.find((r) => r.kind === "field" && r.field.json_name === "tags");
    expect(tags).toMatchObject({ depth: 1 });
  });

  it("marks a recursive reference un-expandable instead of looping", () => {
    const rows = deriveRows(SCHEMA, new Set(["/filters", "/filters/nested"]));
    const nested = rows.find((r) => r.kind === "field" && r.field.json_name === "nested")!;
    expect(nested.kind === "field" && nested.recursive).toBe(true);
    expect(nested.kind === "field" && nested.expandable).toBe(false);
    // and nothing below it was emitted twice
    expect(rows.filter((r) => r.kind === "field" && r.field.json_name === "nested")).toHaveLength(1);
  });

  it("returns [] for a schema whose root is missing", () => {
    expect(deriveRows({ root: "t.Nope", messages: [], enums: [] }, new Set())).toEqual([]);
  });
});
```

- [x] **Step 2: Run** — `pnpm test src/features/contract/tree.test.ts` — FAIL (module missing).

- [x] **Step 3: Implement** — `src/features/contract/tree.ts`:

```ts
import type { MessageSchemaIpc, MessageNodeIpc, FieldNodeIpc } from "@/ipc/bindings";

export type ContractRow =
  | {
      kind: "field";
      /** Unique row id: `/`-joined json_name path from the root. */
      path: string;
      depth: number;
      field: FieldNodeIpc;
      /** Resolved enum values (full list) when the field is enum-typed. */
      enumValues: string[] | null;
      /** Has a known message type that is NOT an ancestor (chevron shown). */
      expandable: boolean;
      expanded: boolean;
      /** Message type already on the ancestor path (`↻ recursive` marker). */
      recursive: boolean;
    }
  | { kind: "oneof"; path: string; depth: number; label: string };

/** Flatten the schema into display rows honoring the `expanded` path set.
 *  A visited-set along each expansion path stops recursive types. */
export function deriveRows(
  schema: MessageSchemaIpc,
  expanded: ReadonlySet<string>,
): ContractRow[] {
  const byName = new Map(schema.messages.map((m) => [m.full_name, m]));
  const enums = new Map(schema.enums.map((e) => [e.full_name, e.values]));
  const out: ContractRow[] = [];

  const walk = (
    node: MessageNodeIpc,
    depth: number,
    prefix: string,
    ancestors: ReadonlySet<string>,
  ) => {
    let lastOneof: string | null = null;
    for (const field of node.fields) {
      if (field.oneof_group && field.oneof_group !== lastOneof) {
        out.push({
          kind: "oneof",
          path: `${prefix}/oneof:${field.oneof_group}`,
          depth,
          label: field.oneof_group,
        });
      }
      lastOneof = field.oneof_group;

      const path = `${prefix}/${field.json_name}`;
      const recursive = field.message_type !== null && ancestors.has(field.message_type);
      const target = field.message_type ? (byName.get(field.message_type) ?? null) : null;
      const expandable = target !== null && !recursive;
      const isExpanded = expandable && expanded.has(path);
      out.push({
        kind: "field",
        path,
        depth,
        field,
        enumValues: field.enum_type ? (enums.get(field.enum_type) ?? null) : null,
        expandable,
        expanded: isExpanded,
        recursive,
      });
      if (isExpanded && target) {
        walk(target, depth + 1, path, new Set([...ancestors, target.full_name]));
      }
    }
  };

  const root = byName.get(schema.root);
  if (root) walk(root, 0, "", new Set([root.full_name]));
  return out;
}
```

- [x] **Step 4: Run** — `pnpm test src/features/contract/tree.test.ts && pnpm lint` — green. ✅ 5/5 → 6/6 + lint, commits `bdcb442` + `0a5f0ab` (review-fix: order-independent oneof headers via seen-set + `@param expanded` doc; no real binding deviations).

- [x] **Step 5: Commit**

```bash
git add src/features/contract/tree.ts src/features/contract/tree.test.ts
git commit -m "feat(contract): pure row derivation for the contract tree

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

### Task 11: `ContractTree` component

**Files:**
- Create: `src/features/contract/ContractTree.tsx`
- Test: `src/features/contract/ContractTree.test.tsx`

- [x] **Step 1: Failing tests** — `src/features/contract/ContractTree.test.tsx` (reuse the SCHEMA fixture from `tree.test.ts` — copy it locally with the same `f` factory):

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
// ... f(...) factory + SCHEMA fixture identical to tree.test.ts ...
import { ContractTree } from "./ContractTree";

describe("ContractTree", () => {
  it("renders field names, type labels, enum values and a oneof header", () => {
    render(<ContractTree schema={SCHEMA} />);
    expect(screen.getByText("query")).toBeInTheDocument();
    expect(screen.getByText("string", { exact: true })).toBeInTheDocument();
    expect(screen.getByText(/ASC \| DESC/)).toBeInTheDocument();
    expect(screen.getByText(/oneof selector/i)).toBeInTheDocument();
  });

  it("expands and collapses a message field", async () => {
    const user = userEvent.setup();
    render(<ContractTree schema={SCHEMA} />);
    expect(screen.queryByText("tags")).toBeNull();
    await user.click(screen.getByRole("button", { name: /expand filters/i }));
    expect(screen.getByText("tags")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /collapse filters/i }));
    expect(screen.queryByText("tags")).toBeNull();
  });

  it("marks recursive references and offers no expansion for them", async () => {
    const user = userEvent.setup();
    render(<ContractTree schema={SCHEMA} />);
    await user.click(screen.getByRole("button", { name: /expand filters/i }));
    expect(screen.getByTitle("recursive")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /expand nested/i })).toBeNull();
  });

  it("shows proto_name as the row tooltip", () => {
    render(<ContractTree schema={SCHEMA} />);
    expect(screen.getByTitle("query")).toBeInTheDocument(); // title = proto_name
  });

  it("renders an empty state for a fieldless schema", () => {
    render(<ContractTree schema={{ root: "t.E", messages: [{ full_name: "t.E", fields: [] }], enums: [] }} />);
    expect(screen.getByText(/no fields/i)).toBeInTheDocument();
  });
});
```

- [x] **Step 2: Run** — `pnpm test src/features/contract/ContractTree.test.tsx` — FAIL.

- [x] **Step 3: Implement** — `src/features/contract/ContractTree.tsx`:

```tsx
import { useState } from "react";
import { ChevronRight } from "lucide-react";
import type { MessageSchemaIpc } from "@/ipc/bindings";
import { cn } from "@/lib/cn";
import { deriveRows } from "./tree";

export interface ContractTreeProps {
  schema: MessageSchemaIpc;
}

/** Read-only field tree over a flat MessageSchema. Expansion is local state —
 *  it resets with the panel, deliberately (no persistence per spec). */
export function ContractTree({ schema }: ContractTreeProps) {
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const rows = deriveRows(schema, expanded);

  const toggle = (path: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });

  if (rows.length === 0) {
    return <div className="px-3 py-2 text-xs text-muted-foreground">No fields</div>;
  }

  return (
    <div className="py-1 font-mono text-xs leading-6">
      {rows.map((row) =>
        row.kind === "oneof" ? (
          <div
            key={row.path}
            style={{ paddingLeft: `${row.depth * 14 + 26}px` }}
            className="text-[10px] uppercase tracking-wide text-muted-foreground"
          >
            oneof {row.label}
          </div>
        ) : (
          <div
            key={row.path}
            style={{ paddingLeft: `${row.depth * 14 + 8}px` }}
            className="flex items-center gap-1 pr-3"
          >
            {row.expandable ? (
              <button
                type="button"
                onClick={() => toggle(row.path)}
                aria-label={`${row.expanded ? "Collapse" : "Expand"} ${row.field.json_name}`}
                className="flex size-4 flex-none items-center justify-center text-muted-foreground hover:text-foreground"
              >
                <ChevronRight className={cn("size-3 transition-transform", row.expanded && "rotate-90")} />
              </button>
            ) : (
              <span className="size-4 flex-none" aria-hidden />
            )}
            <span title={row.field.proto_name} className="truncate text-foreground">
              {row.field.json_name}
            </span>
            {row.recursive ? (
              <span title="recursive" className="text-muted-foreground">↻</span>
            ) : null}
            <span className="ml-auto flex-none pl-3 text-muted-foreground">
              {row.field.type_label}
              {row.enumValues ? `: ${row.enumValues.join(" | ")}` : ""}
            </span>
          </div>
        ),
      )}
    </div>
  );
}
```

- [x] **Step 4: Run** — `pnpm test src/features/contract/ContractTree.test.tsx && pnpm lint` — green. ✅ 5/5 + lint, commits `ce2fcdf` + `00d2c61` (review-fix: aria-label on `↻` marker + `useMemo(deriveRows)`). Deviation: `getByText("string")` → `getAllByText` (fixture has 3 string-typed fields). ⚠ Также вскрылась регрессия Task 9: всегда-видимая Tooltip-кнопка хинтов рушила изолированные CallPanel-тесты без `TooltipProvider` (prod ок — провайдер в `main.tsx`); починено отдельным коммитом `fe744cb` (обёртка рендеров в `TooltipProvider`). Полный прогон: 718/718 + lint.

- [x] **Step 5: Commit**

```bash
git add src/features/contract/ContractTree.tsx src/features/contract/ContractTree.test.tsx
git commit -m "feat(contract): ContractTree component over deriveRows

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

### Task 12: `ContractPanel` floating overlay

**Files:**
- Create: `src/features/contract/ContractPanel.tsx`
- Test: `src/features/contract/ContractPanel.test.tsx`

- [x] **Step 1: Failing tests** — `src/features/contract/ContractPanel.test.tsx` (SCHEMA fixture as in `tree.test.ts`; an `OUT` variant with `root: "t.Resp"` + one field `f("ok", "bool", "scalar")`):

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TooltipProvider } from "@/components/ui/tooltip";
// ... f(...) factory, SCHEMA (root t.Req), OUT (root t.Resp with field "ok") ...
import { ContractPanel } from "./ContractPanel";

function renderPanel(p: Partial<React.ComponentProps<typeof ContractPanel>> = {}) {
  const props = {
    open: true,
    onClose: vi.fn(),
    method: "SearchUsers",
    inputSchema: SCHEMA,
    outputSchema: OUT,
    ...p,
  };
  render(
    <TooltipProvider>
      <ContractPanel {...props} />
    </TooltipProvider>,
  );
  return props;
}

describe("ContractPanel", () => {
  it("renders nothing when closed", () => {
    renderPanel({ open: false });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("shows the method name and the Request tree by default", () => {
    renderPanel();
    expect(screen.getByRole("dialog", { name: /method contract/i })).toBeInTheDocument();
    expect(screen.getByText("SearchUsers")).toBeInTheDocument();
    expect(screen.getByText("query")).toBeInTheDocument(); // from inputSchema
  });

  it("switches to the Response tree (visible pre-send)", async () => {
    const user = userEvent.setup();
    renderPanel();
    await user.click(screen.getByRole("tab", { name: /response/i }));
    expect(screen.getByText("ok")).toBeInTheDocument(); // from outputSchema
    expect(screen.queryByText("query")).toBeNull();
  });

  it("shows the unavailable placeholder when the side's schema is null", async () => {
    const user = userEvent.setup();
    renderPanel({ outputSchema: null });
    await user.click(screen.getByRole("tab", { name: /response/i }));
    expect(screen.getByText(/Контракт недоступен/)).toBeInTheDocument();
  });

  it("closes via ✕ and via Escape, but not when Escape was consumed elsewhere", () => {
    const p = renderPanel();
    fireEvent.click(screen.getByRole("button", { name: /close contract/i }));
    expect(p.onClose).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(window, { key: "Escape" });
    expect(p.onClose).toHaveBeenCalledTimes(2);

    const consumed = new KeyboardEvent("keydown", { key: "Escape", cancelable: true });
    consumed.preventDefault(); // e.g. Monaco closing its suggest widget
    window.dispatchEvent(consumed);
    expect(p.onClose).toHaveBeenCalledTimes(2);
  });
});
```

- [x] **Step 2: Run** — `pnpm test src/features/contract/ContractPanel.test.tsx` — FAIL.

- [x] **Step 3: Implement** — `src/features/contract/ContractPanel.tsx`:

```tsx
import { useEffect, useState } from "react";
import { X } from "lucide-react";
import type { MessageSchemaIpc } from "@/ipc/bindings";
import { Button } from "@/components/ui/button";
import { UnderlineTabs } from "@/components/ui/underline-tabs";
import { ContractTree } from "./ContractTree";

export interface ContractPanelProps {
  open: boolean;
  onClose: () => void;
  /** Method display name for the header (plain name, not full path). */
  method: string;
  inputSchema: MessageSchemaIpc | null;
  outputSchema: MessageSchemaIpc | null;
}

type Side = "request" | "response";

/** Floating, read-only contract reference over the request pane. Deliberately NO
 *  click-outside dismissal — the core scenario is typing in the editor while the
 *  panel stays open. Esc closes it unless something (e.g. Monaco's suggest widget)
 *  already consumed the keydown. */
export function ContractPanel({ open, onClose, method, inputSchema, outputSchema }: ContractPanelProps) {
  const [side, setSide] = useState<Side>("request");

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !e.defaultPrevented) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;
  const schema = side === "request" ? inputSchema : outputSchema;

  return (
    <div
      role="dialog"
      aria-label="Method contract"
      className="absolute right-2 top-12 z-20 flex max-h-[70%] w-80 flex-col overflow-hidden rounded-lg border border-border bg-popover shadow-lg"
    >
      <div className="flex h-9 flex-none items-center gap-2 border-b border-border px-3">
        <span className="truncate text-xs font-medium">{method || "Contract"}</span>
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={onClose}
          aria-label="Close contract"
          className="ml-auto text-muted-foreground hover:text-foreground"
        >
          <X />
        </Button>
      </div>
      <div className="flex h-8 flex-none items-center border-b border-border px-2">
        <UnderlineTabs<Side>
          value={side}
          onChange={setSide}
          items={[
            { value: "request", label: "Request" },
            { value: "response", label: "Response" },
          ]}
        />
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {schema ? (
          <ContractTree schema={schema} />
        ) : (
          <div className="px-3 py-3 text-xs text-muted-foreground">
            Контракт недоступен — схема метода не получена (reflection выключен или
            сервер недоступен).
          </div>
        )}
      </div>
    </div>
  );
}
```

- [x] **Step 4: Run** — `pnpm test src/features/contract && pnpm lint` — green. ✅ 16/16 contract + lint, commits `090daa8` + `ac79c6e` (review-fix: Esc-listener stabilized via `onCloseRef` per CallPanel idiom, before Task 13's unstable `onClose`; + doc comment on `side` persistence). No deviations.

- [x] **Step 5: Commit**

```bash
git add src/features/contract/ContractPanel.tsx src/features/contract/ContractPanel.test.tsx
git commit -m "feat(contract): floating ContractPanel with Request/Response tabs

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

🧹 **/clear-чекпойнт** — Phase C done (overlay UI complete in isolation).

---

## Phase D — integration + final gate

### Task 13: CallPanel integration + response-side hints threading

**Files:**
- Modify: `src/features/workflow/CallPanel.tsx`
- Modify: `src/features/response/ResponsePanel.tsx`
- Modify: `src/features/response/ResponseBody.tsx`
- Modify: `src/features/bodyview/BodyView.tsx` (response-mode schema attach)
- Test: `src/features/workflow/CallPanel.editable.test.tsx`

> Note (из ревью Task 2): заодно поправь JSDoc у `fetchMessageSchemaSafe` в
> `src/features/workflow/actions.ts` (~line 64) — null-схема теперь деградирует не
> только autocomplete, но и contract view / response hints.

- [x] **Step 1: Failing tests** — append to `CallPanel.editable.test.tsx`:

```tsx
describe("CallPanel contract overlay", () => {
  it("opens and closes the overlay from the tab-strip toggle", () => {
    render(
      <TooltipProvider>
        <CallPanel step={draft} onPatch={() => {}} editable />
      </TooltipProvider>,
    );
    expect(screen.queryByRole("dialog", { name: /method contract/i })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /toggle method contract/i }));
    expect(screen.getByRole("dialog", { name: /method contract/i })).toBeInTheDocument();
    // schema fetch is mocked away → both sides null → placeholder text
    expect(screen.getByText(/Контракт недоступен/)).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: /method contract/i })).toBeNull();
  });

  it("offers no contract toggle on non-editable panels", () => {
    render(<CallPanel step={draft} onPatch={() => {}} />);
    expect(screen.queryByRole("button", { name: /toggle method contract/i })).toBeNull();
  });
});
```

- [x] **Step 2: Run** — `pnpm test src/features/workflow/CallPanel.editable.test.tsx` — FAIL (no toggle button rendered: CallPanel doesn't pass `onToggleContract`).

- [x] **Step 3: Implement CallPanel.** In `CallPanel.tsx`:
  - imports: `useState` (extend the react import), `import { ContractPanel } from "@/features/contract/ContractPanel";`
  - inside the component:

```ts
const [contractOpen, setContractOpen] = useState(false);
const schemaTarget = editable
  ? { address: step.address, tls: step.tls, service: step.service, method: step.method }
  : { address: "", tls: false, service: "", method: "" };
const schema = useMessageSchema(schemaTarget, "input");
const outputSchema = useMessageSchema(schemaTarget, "output");
```

  (This replaces the existing single `useMessageSchema(...)` call — keep the explanatory comment, now mentioning both sides.)
  - request pane: wrap in a `relative` container and mount the panel:

```tsx
<ResizablePanel id="request" minSize="20%">
  <div className="relative h-full">
    <RequestTabs
      step={step}
      serviceAuth={step.auth}
      onBody={onBody}
      onMetadata={onMetadata}
      onSubmit={() => sendShortcutRef.current()}
      onResetTemplate={editable ? onResetBody : undefined}
      schema={schema}
      contractOpen={editable ? contractOpen : undefined}
      onToggleContract={editable ? () => setContractOpen((o) => !o) : undefined}
    />
    {editable ? (
      <ContractPanel
        open={contractOpen}
        onClose={() => setContractOpen(false)}
        method={step.method}
        inputSchema={schema}
        outputSchema={outputSchema}
      />
    ) : null}
  </div>
</ResizablePanel>
```

  - response slot: `<ResponseSlot step={step} schema={outputSchema} />` and:

```tsx
function ResponseSlot({ step, schema }: { step: Step; schema: MessageSchemaIpc | null }) {
  // ... respState unchanged ...
  return <ResponsePanel state={respState} outcome={step.outcome} error={step.error} schema={schema} />;
}
```

  (Import `MessageSchemaIpc` type from `@/ipc/bindings`.)

- [x] **Step 4: Thread to the response editor.**
  - `ResponsePanel.tsx`: add `schema?: MessageSchemaIpc | null;` to the props, destructure it, and pass it on: `<ResponseBody json={outcome.response_json} schema={schema} />`.
  - `ResponseBody.tsx`:

```tsx
export interface ResponseBodyProps {
  json: string;
  /** Output-message schema → inlay type hints on the rendered response. */
  schema?: MessageSchemaIpc | null;
}

export function ResponseBody({ json, schema }: ResponseBodyProps) {
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <BodyView mode="response" value={json} schema={schema} />
    </div>
  );
}
```

  - `BodyView.tsx` — let response models carry the schema (completions stay suppressed by `readOnly`; this deliberately relaxes Group B #4's response-isolation note, which guarded completions only):
    - in `onMount`, move the `setModelSchema(editor.getModel(), schemaRef.current ?? null);` line OUT of the `if (mode === "request")` branch so it runs for both modes (place it right after `live.current = {...}`; the `onKeyUp` trigger stays request-only). For response mode it must run AFTER `renderResponse(...)` `setValue` calls — order inside `onMount` is fine either way since the model instance is the same; keep it before the mode branches for simplicity.
    - in the schema-sync effect, drop the `if (mode !== "request") return;` guard (the effect body already handles null models; keep `refreshBodyHints()` + `scheduleGhost(0)` — the ghost scheduler self-gates on `l.ghost`, which response mode never creates).
    - update the `schema` prop doc comment: it now serves request autocomplete+hints AND response hints.

- [x] **Step 5: Run** — `pnpm test src/features/workflow src/features/response src/features/bodyview && pnpm lint`
Expected: green (response component tests pass the new optional prop untouched). ✅ 291/291 affected
+ lint clean; full suite 725/725.

- [x] **Step 6: Commit** ✅ `43680b4` (impl) + `35154c5` (review-fix: explicit `grpcMessageSchema`
mock in the overlay test — was passing via a caught undefined-call). Spec review ✅, code-quality
review APPROVED (3 Minor nits: 2 skipped as plan-intentional / anti-pattern, 1 applied = the mock fix).

```bash
git add src/features/workflow/CallPanel.tsx src/features/workflow/CallPanel.editable.test.tsx src/features/response src/features/bodyview/BodyView.tsx
git commit -m "feat(workflow): contract overlay in CallPanel + response-side type hints

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

### Task 14: full gate + live verification

**Files:**
- Modify: `docs/superpowers/plans/2026-06-10-contract-view.md` (status banner)

- [x] **Step 1: Full suites** — ✅ 2026-06-11: `pnpm lint` clean · `pnpm test` 725/725 (110 files) ·
`pnpm build` ok · `cargo test -p handshaker-core` ok · `cargo test -p handshaker` 43/43.

```bash
pnpm lint && pnpm test && pnpm build
cargo test -p handshaker-core && cargo test -p handshaker
```

Expected: everything green (FE suite grows from 681; both Rust crates pass; build succeeds).

- [ ] **Step 2: Live WebView2 pass** (human-assisted — `pnpm tauri dev` against a reflection-enabled server). Checklist (обновлён под решения Phase E: хинты — только на ответе, запрос несёт контракт через ghost + автокомплит):
  - [x] ghost skeleton: рисуется между скобками пустого шаблона `{\n}`, прижат к `}`, шрифт/сетка/отступ совпадают с редактором, каретка не прыгает на Enter, однострочный объект — призрак подавлен, исчезает при заполнении всех полей, не показывается во вложенных объектах (проверено по ходу фикс-цикла 2026-06-11);
  - [x] autocomplete скрывает уже добавленные поля (+ членов занятого oneof); `"` не открывает пустой виджет на полностью заполненном объекте;
  - [ ] тоггл хинтов гасит ghost (запрос) и inlay-хинты (ответ) мгновенно;
  - [ ] contract toggle открывает плавающую панель; вкладки Request/Response листают оба контракта до Send; вложенное раскрытие + маркер рекурсии `↻` работают;
  - [ ] печать в редакторе при открытой панели её не закрывает; Esc при открытом suggest-виджете закрывает сперва виджет, вторым Esc — панель;
  - [ ] Reset-to-template (`↺`, executeEdits) — теперь единственный способ получить полный шаблон значений; без задвоения хинтов (monaco#4700) и ghost-артефактов;
  - [ ] response-хинты на отрисованном (возможно, элидированном) ответе после Send: метки совпадают с типами полей, enum preview (`enum X: A | B | …`) корректен.

- [ ] **Step 3: Update the plan status banner** to `🎉 feature-complete — live-verified <date>` (or list any deviations found), commit:

```bash
git add docs/superpowers/plans/2026-06-10-contract-view.md
git commit -m "docs(plan): contract view — mark complete

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

- [ ] **Step 4: Hand off to `superpowers:finishing-a-development-branch`** (ff-merge to `main`, archive plan+spec per the CLAUDE.md convention, update the CLAUDE.md Active-work section; do NOT remove the harness worktree).

Steps 2–4 выполняются **после Phase E** (ниже).

---

## Phase E — live-pass доводка (UX по best practice)

Выросла из живой верификации Task 14 Step 2; каждое решение одобрено пользователем
2026-06-11. Уже сделано (коммиты в баннере): убрано автозаполнение при выборе метода
(пустой шаблон `EMPTY_BODY_TEMPLATE = "{\n}"`), inlay-хинты оставлены только на ответе,
комплит скрывает присутствующие ключи и членов занятых oneof-групп (по образцу
vscode-json-languageservice), пять ghost-фиксов (шрифт/якорь/подавление/синхронный
ре-якорь).

### Task 15: error-tolerant ghost — висящая запятая не гасит призрак

Best practice (VS Code / jsonc-parser): редакторские подсказки работают на
error-tolerant парсинге («On invalid input, the parser tries to be as fault tolerant
as possible, but still return a result»). У нас ghost завязан на строгий
`parseWithSpans`: `{"a": "x",⏎}` → парс null → зона снимается ровно в каноничной
паузе «поставил запятую, выбираю следующее поле».

**Files:**
- Modify: `src/features/bodyview/ghost.ts`, `src/features/bodyview/ghost.test.ts`

- [x] **Step 1: Failing tests** — `computeGhostLines`:
  - `'{\n  "query": "x",\n}'` → блок `{ afterLine: 2, lines: ['  "deadline": Timestamp'] }`
    (висящая запятая перед `}` не гасит ghost);
  - `'{\n  "deadline": { "seconds": 1, },\n}'` → блок (вложенная висящая запятая тоже
    ремонтируется; missing `query`, afterLine 2);
  - ремонт не оживляет настоящие инвалиды: `'{ "query": '` → по-прежнему null.
- [x] **Step 2: Run** — `pnpm test src/features/bodyview/ghost.test.ts` — FAIL. ✅ (2 new FAIL)
- [x] **Step 3: Implement** — фолбэк с **сохранением длины текста**: если строгий парс
  упал — `text.replace(/,(?=\s*[}\]])/g, " ")` (каждая запятая, за которой до `}`/`]`
  только whitespace, становится пробелом той же ширины → все оффсеты/строки якорной
  математики остаются честными для исходного текста) и второй `parseWithSpans`.
  Якорная логика без изменений.
- [x] **Step 4: Run** — ghost-тесты, затем полный гейт (`pnpm lint && pnpm test`). ✅ 15/15 + полный гейт 746/746 (после Task 17).
- [x] **Step 5: Commit** — ✅ `52f8092`.

### Task 16: комплит вставляет запятую-разделитель (как VS Code)

Эталон: `evaluateSeparatorAfter` в vscode-json-languageservice — после диапазона вставки
сканируется следующий токен; `,` / `}` / `]` / EOF → ничего, иначе (следующее свойство)
→ к insertText дописывается `,`. У нас принятие подсказки на строке над существующим
полем даёт `"key": ""` без запятой → невалидный JSON.

**Files:**
- Modify: `src/features/bodyview/completion.ts`, `src/features/bodyview/completion.test.ts`

- [x] **Step 1: Failing tests** — чистый `separatorAfter(textAfter)`:
  - `'\n  "userId": ""\n}'` → `","` (дальше другое свойство);
  - `'\n}'` → `""`; `']'` → `""`; `', "x": 1'` → `""` (запятая уже есть); `''` → `""`.
- [x] **Step 2: Run** — FAIL (функции нет). ✅
- [x] **Step 3: Implement** — `separatorAfter`: первый непробельный символ ∈ {`,`,`}`,`]`}
  или конец текста → `""`, иначе `","`. В провайдере: текст от конца range до конца
  модели → `sep`; `insertText = s.insertText + sep` для обычных вставок (key-скаффолды
  и value-подсказки), **кроме** `asKeyOnly` (дальше уже стоит `:` — разделитель не нужен).
- [x] **Step 4: Run** — completion-тесты + lint. ✅ 40/40.
- [x] **Step 5: Commit** — ✅ `5edc60a`.

### Task 17: sortText — proto-порядок полей в виджете

Виджет без `sortText` сортируется по алфавиту, а ghost и контракт-панель показывают
поля в proto-порядке — рассинхрон поверхностей. Поля и значения enum получают
`sortText` = zero-padded индекс.

**Files:**
- Modify: `src/features/bodyview/completion.ts`, `src/features/bodyview/completion.test.ts`

- [x] **Step 1: Failing tests** — `computeSuggestions(SCHEMA, "{\n  ")`: `sortText`
  определён и строго возрастает в порядке схемы; то же для значений enum.
- [x] **Step 2: Run** — FAIL. ✅
- [x] **Step 3: Implement** — `Suggestion.sortText?: string`; в `buildKeySuggestions`
  и enum-ветке `buildValueSuggestions` — `String(i).padStart(4, "0")` по индексу
  **после** фильтрации; провайдер пробрасывает `sortText`.
- [x] **Step 4: Run** — completion-тесты + полный гейт. ✅ 42/42 · lint clean · 746/746.
- [x] **Step 5: Commit** — ✅ `c11fe34`.

**Отложено осознанно (кандидаты вне scope):** отступ ghost фиксирован 2 пробела (не
следует за tabSize), oneof-группы в ghost не размечены, dangling `"key":` без значения
гасит ghost (в этот момент открыт suggest-виджет — принято).
