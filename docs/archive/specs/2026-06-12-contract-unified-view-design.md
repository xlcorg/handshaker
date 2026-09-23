# Contract tab — unified view (no side switch) — design

> **Status:** ✅ Design approved 2026-06-12 (brainstorm).
> Branch: `claude/nostalgic-jang-778d08`. **Amends
> `2026-06-11-contract-tab-proto-view-design.md`** (shipped, code-complete):
> the Request | Response segmented switch is judged inconvenient in live use
> and is **removed**; both sides render in one scrollable listing under an
> `rpc` signature line. Reverses one item of that spec's Non-goals (the `rpc`
> signature line is now in scope; streaming flags remain out). Everything else
> from the 2026-06-11 spec — tab placement, default-tab/auto-switch logic,
> token rendering, click-to-scroll, backend schema fields — is unchanged.

**Goal:** The Contract tab shows the whole method contract at once — an
`rpc`-signature header naming both root types, then a single deduplicated
proto-source listing of every reachable type. No mode switching: request and
response are one document.

**Decisions locked during brainstorming:**

- **Variant: rpc header + merged listing** (alternative — two `// Request` /
  `// Response` sections with per-section duplicates — rejected: longer,
  duplicates shared types, anchor ambiguity).
- Types shared between the two sides print **once**; refs from both sides
  scroll to the same block.
- The slim header row of `ContractView` (side switch + right-aligned method
  name) is **deleted entirely** — the method name moves into the `rpc` line.
- No `stream` modifiers in the rpc line — `ContractInfo` carries no streaming
  flag (YAGNI, unchanged from the 2026-06-11 spec).

---

## Renderer — `src/features/contract/proto.ts`

New pure function alongside the existing ones (nothing is deleted here):

```ts
export function renderContractDoc(
  method: string,
  input: MessageSchemaIpc | null,
  output: MessageSchemaIpc | null,
): ProtoDoc
```

`renderProtoDoc(schema)` stays as-is (single-schema listing; used by its tests
and reusable). `renderContractDoc` composes the same block builders:

- **rpc line** — its own leading block (fullName `""`, never a scroll target):
  `rpc <Method>(<InType>) returns (<OutType>);` where `<InType>`/`<OutType>`
  are `typeRef` tokens targeting the two roots. A missing side renders a muted
  `?` (`punct` token) instead of the type ref.
- **Merged type universe:** messages = input's messages, then output's
  messages not already present (by `full_name`); enums likewise. Equal
  `full_name` ⇒ identical definition (same descriptor pool) — first occurrence
  wins, no merge logic.
- **Block order:** rpc line → input root → output root (if distinct from input
  root) → remaining messages (input order, then new-from-output) → enums
  (same union order).
- **`displayNames` collision resolution runs over the union** — a short-name
  collision between a request-side and a response-side type prints full names
  for both, same rule as within one schema.
- One side `null` → its root and its exclusive types simply don't exist in the
  union; the doc is still rendered (rpc line carries the `?`).

## Component — `src/features/contract/ContractView.tsx`

Radically simpler:

- Props become `{ method: string; input; output }` — `side`/`onSide` deleted,
  `ContractSide` type deleted.
- The header row (`h-8` strip: segmented switch + method name) is deleted; the
  component is just the scroll container with three branches:
  - empty `method` → existing "Выбери метод…" hint;
  - both schemas `null` → existing "Контракт недоступен…" placeholder;
  - otherwise → `ProtoView` over `renderContractDoc(method, input, output)`.
- **One side `null`** → the listing renders the available side; below the
  listing a muted one-liner: `Request-схема недоступна.` /
  `Response-схема недоступна.` (matches the existing placeholder tone; no
  toasts — reference surface, never an error surface).

`ProtoView` is unchanged (it already renders any `ProtoDoc`; the rpc line is
just another block of tokens).

## Integration — `src/features/response/ResponsePanel.tsx`

- `side` state, `setSide`, and the `ContractSide` import die; `ContractView`
  is called with `method/input/output` only.
- Tab logic (default-to-Contract pre-send, auto-switch-to-Body on arrival,
  `userPickedTab`) is untouched.

`CallPanel` wiring is untouched (`ContractInfo` shape unchanged).

### Files

| file | change |
|------|--------|
| `src/features/contract/proto.ts` / `.test.ts` | **+** `renderContractDoc` (rpc line, union/dedup, `?` for missing side) + tests |
| `src/features/contract/ContractView.tsx` / `.test.tsx` | **−** side switch, header row, `ContractSide`; placeholder branches reworked; tests rewritten |
| `src/features/response/ResponsePanel.tsx` / `.test.tsx` | **−** `side` state/prop threading; "side switch survives" test → "both sides visible at once" |
| `src/features/workflow/CallPanel.editable.test.tsx` | side-assignment test reworked: both fields visible in one listing (no Response click) |

## Testing

- **`proto.ts`:** rpc line shape (method name, clickable refs to both roots,
  trailing `;`); shared type printed once with refs from both sides resolving
  to it; union block order; cross-side short-name collision → full names;
  input-only / output-only → `?` in the rpc line and the present side's blocks;
  identical input and output root → one block.
- **`ContractView`:** renders both sides' fields at once; method visible in
  the rpc line; empty-method hint; both-null placeholder; one-side-null muted
  note.
- **`ResponsePanel`:** existing contract-tab tests minus the side switch; new
  assertion that request and response content coexist.
- **Gate:** `pnpm lint` (tsc -b) + vitest + `pnpm build`; no Rust changes.

## Non-goals (YAGNI)

- `stream` modifiers in the rpc line (no streaming flag in `ContractInfo`).
- Collapsing/folding blocks, search, copy-as-proto — unchanged from 2026-06-11.
- Section separators between "request types" and "response types" — the union
  is one flat document by design; the rpc line is the only header.

## Edge cases

- **Same root type for request and response** (`rpc Ping(Msg) returns (Msg)`)
  — one printed block; both rpc-line refs target it.
- **Recursive / shared types** — already one-block-per-type by construction;
  dedup just extends the invariant across the union.
- **Both sides null with a method picked** — "Контракт недоступен" (existing
  text); rpc line is not rendered (a line with two `?` carries no information).
