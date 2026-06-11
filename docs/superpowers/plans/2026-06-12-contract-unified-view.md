# Contract Tab — Unified View (no side switch) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task.
> Steps use checkbox (`- [ ]`) syntax for tracking.

> **Status:** 🚧 not started.
> **Spec:** `docs/superpowers/specs/2026-06-12-contract-unified-view-design.md`
> (approved 2026-06-12). Amends the shipped
> `2026-06-11-contract-tab-proto-view-design.md` (code-complete, commits up to
> `72b191a`): the Request|Response switch is removed in favor of one merged
> listing under an `rpc` signature line.
> Branch `claude/nostalgic-jang-778d08` (existing feature worktree).
> NB: `pnpm lint` in this repo is only `tsc -b` — no eslint.

**Goal:** The Contract tab shows the whole method contract at once — an `rpc`
signature line plus one deduplicated proto listing of both sides' types — and
the Request|Response segmented switch is deleted.

**Architecture:** A new pure `renderContractDoc(method, input, output)` in
`proto.ts` composes the existing block builders over the union of both schemas
(dedup by `full_name`, collision-aware display names over the union, `?` for a
missing side). `ContractView` loses the switch, the header strip, and the
`side`/`onSide` props; `ResponsePanel` loses the `side` state. `ProtoView`,
`renderProtoDoc`, the backend, and `CallPanel` wiring are untouched.

**Tech Stack:** React 18 · Vitest + RTL. No Rust changes.

**Gate commands:**
- `pnpm lint` (tsc -b) · `pnpm vitest run` · `pnpm build`
- All git commands: `git -C <worktree>`; verify `git branch --show-current` =
  `claude/nostalgic-jang-778d08` before every commit.

---

### Task 1: `renderContractDoc` in `proto.ts`

Purely additive — the suite stays green throughout.

**Files:**
- Modify: `src/features/contract/proto.ts` (append)
- Modify: `src/features/contract/proto.test.ts` (append; reuses the existing
  `f`/`lineText`/`blockText` helpers and imports already at the top of the file)

- [x] **Step 1: Write the failing tests**

Append to `src/features/contract/proto.test.ts`. Extend the import on line 3 to
include `renderContractDoc`:

```ts
import { renderProtoDoc, renderContractDoc, type ProtoBlock, type ProtoToken } from "./proto";
```

Then append at the end of the file:

```ts
describe("renderContractDoc", () => {
  const IN: MessageSchemaIpc = {
    root: "t.Req",
    messages: [
      {
        full_name: "t.Req",
        fields: [
          f("query", 1, "string", "scalar"),
          f("item", 2, "Item", "message", { message_type: "t.Item" }),
        ],
      },
      { full_name: "t.Item", fields: [f("name", 1, "string", "scalar")] },
    ],
    enums: [],
  };
  const OUT: MessageSchemaIpc = {
    root: "t.Resp",
    messages: [
      {
        full_name: "t.Resp",
        fields: [
          f("items", 1, "repeated Item", "message", { repeated: true, message_type: "t.Item" }),
          f("status", 2, "Status", "enum", { enum_type: "t.Status" }),
        ],
      },
      { full_name: "t.Item", fields: [f("name", 1, "string", "scalar")] },
    ],
    enums: [{ full_name: "t.Status", values: [{ name: "OK", number: 0 }] }],
  };

  it("opens with the rpc signature line referencing both roots", () => {
    const doc = renderContractDoc("Search", IN, OUT);
    expect(doc.blocks[0].fullName).toBe("");
    expect(lineText(doc.blocks[0].lines[0])).toBe("rpc Search(Req) returns (Resp);");
    const refs = doc.blocks[0].lines[0].filter(
      (t): t is Extract<ProtoToken, { kind: "typeRef" }> => t.kind === "typeRef",
    );
    expect(refs.map((r) => r.target)).toEqual(["t.Req", "t.Resp"]);
  });

  it("prints a shared type once, in root-first union order", () => {
    const doc = renderContractDoc("Search", IN, OUT);
    expect(doc.blocks.map((b) => b.fullName)).toEqual(["", "t.Req", "t.Resp", "t.Item", "t.Status"]);
  });

  it("all typeRef targets in the merged doc resolve to printed blocks", () => {
    const doc = renderContractDoc("Search", IN, OUT);
    const printed = new Set(doc.blocks.map((b) => b.fullName));
    const refs = doc.blocks
      .flatMap(allTokens)
      .filter((t): t is Extract<ProtoToken, { kind: "typeRef" }> => t.kind === "typeRef");
    expect(refs.length).toBeGreaterThanOrEqual(5); // rpc(2) + item + items + status
    for (const r of refs) expect(printed.has(r.target)).toBe(true);
  });

  it("renders ? for a missing side and still lists the present side", () => {
    const doc = renderContractDoc("Search", IN, null);
    expect(lineText(doc.blocks[0].lines[0])).toBe("rpc Search(Req) returns (?);");
    expect(doc.blocks.map((b) => b.fullName)).toEqual(["", "t.Req", "t.Item"]);
  });

  it("an identical request and response root prints one block", () => {
    const doc = renderContractDoc("Ping", IN, IN);
    expect(lineText(doc.blocks[0].lines[0])).toBe("rpc Ping(Req) returns (Req);");
    expect(doc.blocks.map((b) => b.fullName)).toEqual(["", "t.Req", "t.Item"]);
  });

  it("resolves short-name collisions across the two sides with full names", () => {
    const a: MessageSchemaIpc = {
      root: "a.Filter",
      messages: [{ full_name: "a.Filter", fields: [] }],
      enums: [],
    };
    const b: MessageSchemaIpc = {
      root: "b.Filter",
      messages: [{ full_name: "b.Filter", fields: [] }],
      enums: [],
    };
    const doc = renderContractDoc("F", a, b);
    expect(lineText(doc.blocks[0].lines[0])).toBe("rpc F(a.Filter) returns (b.Filter);");
  });
});
```

- [x] **Step 2: Run to verify failure**

Run: `pnpm vitest run src/features/contract/proto.test.ts`
Expected: FAIL — `renderContractDoc` is not exported.

- [x] **Step 3: Implement `renderContractDoc`**

Append to `src/features/contract/proto.ts`:

```ts
function dedupeByFullName<T extends { full_name: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const x of items) {
    if (!seen.has(x.full_name)) {
      seen.add(x.full_name);
      out.push(x);
    }
  }
  return out;
}

/** Whole-method contract: an `rpc` signature line (fullName "" — never a scroll
 *  target), then one deduplicated listing of every type reachable from either
 *  side. Shared types print once — refs from both sides land on the same block;
 *  a missing side renders as `?` in the signature. */
export function renderContractDoc(
  method: string,
  input: MessageSchemaIpc | null,
  output: MessageSchemaIpc | null,
): ProtoDoc {
  const messages = dedupeByFullName([...(input?.messages ?? []), ...(output?.messages ?? [])]);
  const enums = dedupeByFullName([...(input?.enums ?? []), ...(output?.enums ?? [])]);
  // Collision resolution must see the union — a request-side and a
  // response-side type with the same short name both print full names.
  const names = displayNames({ root: "", messages, enums });

  const signature: ProtoToken[] = [
    { kind: "keyword", text: "rpc " },
    { kind: "name", text: method },
    { kind: "punct", text: "(" },
    input ? typeRef(input.root, names) : { kind: "punct", text: "?" },
    { kind: "punct", text: ") " },
    { kind: "keyword", text: "returns " },
    { kind: "punct", text: "(" },
    output ? typeRef(output.root, names) : { kind: "punct", text: "?" },
    { kind: "punct", text: ");" },
  ];

  const rootNames = [...new Set([input?.root, output?.root].filter((r): r is string => r != null))];
  const roots = rootNames
    .map((r) => messages.find((m) => m.full_name === r))
    .filter((m): m is MessageNodeIpc => m !== undefined);
  const rest = messages.filter((m) => !rootNames.includes(m.full_name));

  return {
    blocks: [
      { fullName: "", lines: [signature] },
      ...[...roots, ...rest].map((m) => messageBlock(m, names)),
      ...enums.map((e) => enumBlock(e, names)),
    ],
  };
}
```

(`displayNames`, `typeRef`, `messageBlock`, `enumBlock`, `MessageNodeIpc` all
already exist in this file — nothing else changes.)

- [x] **Step 4: Run to verify pass**

Run: `pnpm vitest run src/features/contract/proto.test.ts`
Expected: PASS (9 existing + 6 new = 15 tests).

- [x] **Step 5: Commit**

```powershell
git -C . add src/features/contract/proto.ts src/features/contract/proto.test.ts
git -C . commit -m "feat(contract): renderContractDoc - rpc signature + merged dedup listing"
```

> ✅ 2026-06-12: done — commit `1ace39d`, spec+quality ревью пройдены
> (15/15 в файле, tsc чистый). Minor-заметки ревью: input-null ветка rpc-строки
> покрывается компонентным тестом Task 2; `toHaveLength`-ужесточение
> ref-каунта и tooltip на `?` — кандидаты на полировку, не блокеры.

Append the trailer `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.

### Task 2: Unified `ContractView` + consumer cleanup

One atomic task: changing `ContractViewProps` breaks `ResponsePanel` and the
two test files that click the now-deleted Response button — the suite is only
green with all of them updated in one commit.

**Files:**
- Modify: `src/features/contract/ContractView.tsx` (rewrite)
- Modify: `src/features/contract/ContractView.test.tsx` (rewrite test bodies)
- Modify: `src/features/response/ResponsePanel.tsx` (drop `side` state)
- Modify: `src/features/response/ResponsePanel.test.tsx` (replace one test)
- Modify: `src/features/workflow/CallPanel.editable.test.tsx` (rework one test)

- [ ] **Step 1: Rewrite the ContractView tests**

Replace the entire `describe("ContractView", …)` block in
`src/features/contract/ContractView.test.tsx` (keep the `IN`/`OUT` fixtures;
`fireEvent` and `vi` are no longer used — trim the imports to match):

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ContractView } from "./ContractView";
import type { MessageSchemaIpc } from "@/ipc/bindings";
```

```tsx
/** Text of every rendered proto line, in document order. */
const renderedLines = (container: HTMLElement) =>
  Array.from(container.querySelectorAll("div.whitespace-pre")).map((d) => d.textContent);

describe("ContractView", () => {
  it("renders both sides at once under the rpc signature", () => {
    const { container } = render(<ContractView method="Search" input={IN} output={OUT} />);
    const lines = renderedLines(container);
    expect(lines[0]).toBe("rpc Search(In) returns (Out);");
    expect(screen.getByText("query")).toBeInTheDocument(); // request field
    expect(lines).toContain("message Out {}"); // response root block
  });

  it("asks to pick a method when none is selected", () => {
    render(<ContractView method="" input={null} output={null} />);
    expect(screen.getByText(/Выбери метод/)).toBeInTheDocument();
  });

  it("shows the unavailable placeholder when both schemas are missing", () => {
    render(<ContractView method="Search" input={null} output={null} />);
    expect(screen.getByText(/Контракт недоступен/)).toBeInTheDocument();
  });

  it("renders the present side and notes the missing one", () => {
    const { container } = render(<ContractView method="Search" input={null} output={OUT} />);
    expect(renderedLines(container)[0]).toBe("rpc Search(?) returns (Out);");
    expect(screen.getByText(/Request-схема недоступна/)).toBeInTheDocument();
  });

  it("notes a missing response side likewise", () => {
    const { container } = render(<ContractView method="Search" input={IN} output={null} />);
    expect(renderedLines(container)[0]).toBe("rpc Search(In) returns (?);");
    expect(screen.getByText(/Response-схема недоступна/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vitest run src/features/contract/ContractView.test.tsx`
Expected: FAIL — tsc/props mismatch (`side` required) and/or rpc line missing.

- [ ] **Step 3: Rewrite `ContractView.tsx`**

Full new content of `src/features/contract/ContractView.tsx` (the `ContractSide`
type, `SIDES`, the header strip, and the `cn` import all go away):

```tsx
import { useMemo } from "react";
import type { MessageSchemaIpc } from "@/ipc/bindings";
import { renderContractDoc } from "./proto";
import { ProtoView } from "./ProtoView";

export interface ContractViewProps {
  /** Method display name (plain name, not full path); empty → "pick a method" hint. */
  method: string;
  input: MessageSchemaIpc | null;
  output: MessageSchemaIpc | null;
}

/** Contract-tab content: the whole method contract in one listing — an `rpc`
 *  signature line plus both sides' types, shared types printed once. */
export function ContractView({ method, input, output }: ContractViewProps) {
  const doc = useMemo(
    () => (input !== null || output !== null ? renderContractDoc(method, input, output) : null),
    [method, input, output],
  );
  return (
    <div className="h-full min-h-0 overflow-auto">
      {method.trim().length === 0 ? (
        <div className="px-3.5 py-3 text-xs text-muted-foreground">
          Выбери метод — его контракт появится здесь.
        </div>
      ) : doc ? (
        <>
          <ProtoView doc={doc} />
          {(input === null || output === null) && (
            <div className="px-3.5 pb-3 text-xs text-muted-foreground">
              {input === null ? "Request" : "Response"}-схема недоступна.
            </div>
          )}
        </>
      ) : (
        <div className="px-3.5 py-3 text-xs text-muted-foreground">
          Контракт недоступен — схема метода не получена (reflection выключен или
          сервер недоступен).
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Drop the `side` state from `ResponsePanel.tsx`**

In `src/features/response/ResponsePanel.tsx`:

- Line 10: `import { ContractView, type ContractSide } from "@/features/contract/ContractView";`
  → `import { ContractView } from "@/features/contract/ContractView";`
- Delete line 35: `const [side, setSide] = useState<ContractSide>("request");`
- In the contract branch (lines 129–139), drop the two props:

```tsx
      {tab === "contract" && contract && (
        <div className="min-h-0 flex-1">
          <ContractView method={contract.method} input={contract.input} output={contract.output} />
        </div>
      )}
```

- [ ] **Step 5: Replace the side-switch test in `ResponsePanel.test.tsx`**

Replace `it("the side switch survives leaving and re-entering the Contract tab", …)`
(lines 115–123) with:

```tsx
  it("shows both contract sides at once on the Contract tab", () => {
    const { container } = render(<ResponsePanel state="success" outcome={ok} contract={contract} />);
    fireEvent.click(screen.getByRole("tab", { name: "Contract" }));
    expect(screen.getByText("query")).toBeInTheDocument();
    const lines = Array.from(container.querySelectorAll("div.whitespace-pre")).map((d) => d.textContent);
    expect(lines[0]).toBe("rpc Search(In) returns (Out);");
    expect(lines).toContain("message Out {}");
  });
```

- [ ] **Step 6: Rework the side-assignment test in `CallPanel.editable.test.tsx`**

In `it("threads the request and response schemas to the correct contract sides", …)`
(lines 109–140): the mock and `sideDraft` stay; replace everything from the
`// Schemas resolve async…` comment to the end of the test with:

```tsx
    // Schemas resolve async; the idle panel then auto-defaults to the Contract
    // tab, which lists both sides at once.
    expect(await screen.findByText("req_field")).toBeInTheDocument();
    expect(screen.getByText("resp_field")).toBeInTheDocument();
    // The rpc signature pins which root landed on which side — a swapped
    // input/output wiring would print `rpc GetSides(Resp) returns (Req);`.
    const rpcLine = screen
      .getAllByText("GetSides")
      .map((el) => el.closest("div.whitespace-pre"))
      .find((d) => d !== null);
    expect(rpcLine?.textContent).toBe("rpc GetSides(Req) returns (Resp);");
```

(`getAllByText` — the method name also appears in the draft header's method
picker; the proto line is the one inside a `whitespace-pre` div.)

- [ ] **Step 7: Run the three test files**

Run: `pnpm vitest run src/features/contract/ContractView.test.tsx src/features/response/ResponsePanel.test.tsx src/features/workflow/CallPanel.editable.test.tsx`
Expected: PASS (5 + 9 + 8 = 22 tests).

- [ ] **Step 8: Full frontend gate**

Run: `pnpm lint; if ($?) { pnpm vitest run }`
Expected: tsc clean (would catch any leftover `ContractSide`/`side` references),
all tests pass.

- [ ] **Step 9: Commit**

```powershell
git -C . add src/features/contract/ContractView.tsx src/features/contract/ContractView.test.tsx src/features/response/ResponsePanel.tsx src/features/response/ResponsePanel.test.tsx src/features/workflow/CallPanel.editable.test.tsx
git -C . commit -m "feat(contract): unified view - rpc signature, no side switch"
```

Append the trailer `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.

### Task 3: Gate + docs

**Files:**
- Modify: `docs/superpowers/plans/2026-06-12-contract-unified-view.md` (banner)
- Modify: `docs/superpowers/plans/2026-06-11-contract-tab-proto-view.md` (live checklist)
- Modify: `CLAUDE.md` (Active-work paragraph)

- [ ] **Step 1: Run the full gate**

```powershell
pnpm lint
pnpm vitest run
pnpm build
```

Expected: all green (no Rust changes — cargo gates unaffected). Record the FE
test count for the banner.

- [ ] **Step 2: Update the 2026-06-11 plan's live checklist**

In `docs/superpowers/plans/2026-06-11-contract-tab-proto-view.md`, Task 8
Step 5: replace the two checklist items mentioning the Request|Response
переключатель —

- `- [ ] Переключатель **Request | Response** работает; выбор стороны переживает уход на Body и обратно.`
- `- [ ] Скролл при переключении стороны: позиция прошлой стороны не должна оставлять новую «в середине документа» (если мешает — \`key={side}\` на скроллере); приземление click-to-scroll не вплотную к верху (иначе \`scroll-margin-top\`).`

with:

```markdown
- [ ] ~~Переключатель Request | Response~~ — заменён единым видом
  (спек `2026-06-12-contract-unified-view-design.md`): rpc-строка сверху,
  оба корня кликабельны, общие типы напечатаны один раз.
- [ ] Приземление click-to-scroll не вплотную к верху (иначе `scroll-margin-top`).
```

and the item `- [ ] Выбор метода → Response-панель сама открывает таб **Contract** с proto-листингом (Request-сторона).`
loses its parenthetical → `…с proto-листингом.`

- [ ] **Step 3: Update this plan's banner and `CLAUDE.md`**

Banner → `✅ code-complete — awaiting live WebView2 verification (вместе с
чеклистом Task 8 Step 5 плана 2026-06-11)`, list task commits + gate counts.
In `CLAUDE.md` Active-work: после описания таба добавить «переключатель
Request|Response удалён — единый вид: rpc-строка + объединённый
дедуплицированный листинг (спек 2026-06-12)» и поправить число тестов.

- [ ] **Step 4: Commit docs**

```powershell
git -C . add docs/superpowers/plans/2026-06-12-contract-unified-view.md docs/superpowers/plans/2026-06-11-contract-tab-proto-view.md CLAUDE.md
git -C . commit -m "docs(plan): contract unified view - code-complete banner"
```

Append the trailer `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.

- [ ] **Step 5: Live verification (user-driven, объединённый чеклист)**

Чеклист Task 8 Step 5 плана `2026-06-11-contract-tab-proto-view.md` (с правками
из Step 2 выше) + новые пункты:

- [ ] rpc-строка показывает метод и оба корневых типа; клик по каждому скроллит к блоку.
- [ ] Общий тип (встречается в request и response) напечатан один раз; ссылки с обеих сторон ведут в него.
- [ ] Одна сторона без схемы → `?` в rpc-строке + muted-строка «…-схема недоступна» под листингом.

- [ ] **Step 6: Finish (user green light required)**

После подтверждения чеклиста: флип баннеров обоих планов на
`🎉 feature-complete — live-verified <date>`, затем
`superpowers:finishing-a-development-branch` — ff-merge в `main` (после merge
`a5849a6` main — ancestor HEAD), `git mv` планов+спеков 2026-06-10, 2026-06-11
и 2026-06-12 в `archive/`, обновить `CLAUDE.md` Active-work и индекс памяти.
Do NOT remove the harness worktree.
