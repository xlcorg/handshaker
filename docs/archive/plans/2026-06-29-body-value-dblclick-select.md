# Double-click selects request-body JSON value — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** In the request body editor, a plain double-click on a JSON value selects the whole value (inner text for strings, whole token for number/bool/null) so the user can immediately type a replacement.

**Architecture:** Pure offset-locator core (`valueSelectionAt`) over the already-maintained `live.tree`/`live.spans`; a no-modifier double-click branch in the existing `attachBodyController` `onMouseDown`; and request-only Monaco wiring in `BodyView` that maps the offset range to `editor.setSelection`, deferred a microtask so it lands after Monaco's own word-select.

**Tech Stack:** TypeScript · React · Monaco · Vitest. Pure frontend — no backend/IPC/bindings changes.

**Status banner:** 🎉 DONE 2026-06-29 (ff в `main` `5d0b7b0`; план+спека в `archive/`). Spec: `docs/superpowers/specs/archive/2026-06-29-body-value-dblclick-select-design.md`. Subagent-driven (3 задачи TDD, spec+quality ревью на каждой + финальное ревью = READY TO MERGE). Гейт: `pnpm lint` (tsc) · `pnpm build` (tsc+vite) · vitest bodyview 187 зелёных, +15 новых тестов (11 `selectValue` + 4 `controller`), **0 новых падений** относительно базлайна (48 предсуществующих падений в несвязанных prefs/settings/shell-файлах — `localStorage` undefined под jsdom25 — есть и на `main`, не наша зона). **Live-verified в WebView2 (2026-06-29):** двойной клик по строковому значению выделяет внутренний текст без кавычек, набор заменяет чисто; number/bool/null — весь токен; тройной клик — строка (стандарт Monaco); Ctrl+двойной клик копирует; в ответе без изменений. **Live-pass follow-up `574405b`:** одиночный клик рисовал muted-бокс вокруг слова (Monaco `occurrencesHighlight`, не наша фича — одиночный = detail 1) ⇒ `occurrencesHighlight: "off"` в `EDITOR_OPTIONS` (`src/lib/monaco.ts`). **Урок:** primary-чекаут юзера был завален repo-wide CRLF-churn (529 файлов, working CRLF vs committed LF) + его node_modules сломан (`@rollup/rollup-linux-x64-gnu` отсутствует) — фича верифицировалась в свежем worktree (LF, рабочий install); churn дискарднут по явному разрешению перед ff.

**Gate (whole feature):** `pnpm test` (vitest, current baseline 1134 — expect +~12) · `pnpm lint` (tsc) · `pnpm build` (tsc + vite). Then live WebView2 pass.

---

## File structure

- **Create** `src/features/bodyview/selectValue.ts` — pure `valueSelectionAt(tree, spans, offset)`; one responsibility: compute the char-offset range to select for a value at an offset.
- **Create** `src/features/bodyview/selectValue.test.ts` — unit tests for every node kind + edge cases.
- **Modify** `src/features/bodyview/editorLike.ts` — add `altKey`/`shiftKey` to `EditorMouseEventLike.event`.
- **Modify** `src/features/bodyview/controller.ts` — add `onSelectValue` dep + a no-modifier double-click branch.
- **Modify** `src/features/bodyview/controller.test.ts` — fake-event defaults gain `altKey`/`shiftKey`; new branch tests.
- **Modify** `src/features/bodyview/BodyView.tsx` — request-only `onSelectValue` wiring (deferred `setSelection`).

---

### Task 1: Pure value-selection locator

**Files:**
- Create: `src/features/bodyview/selectValue.ts`
- Test: `src/features/bodyview/selectValue.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/features/bodyview/selectValue.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { parseWithSpans } from "./parse";
import { valueSelectionAt } from "./selectValue";

describe("valueSelectionAt", () => {
  it("selects inner text (no quotes) of a string value", () => {
    const text = `{"k":"hello world"}`;
    const p = parseWithSpans(text)!;
    const r = valueSelectionAt(p.tree, p.spans, text.indexOf("hello"))!;
    expect(text.slice(r.start, r.end)).toBe("hello world");
  });

  it("selects the whole token of a number", () => {
    const text = `{"n":42}`;
    const p = parseWithSpans(text)!;
    const r = valueSelectionAt(p.tree, p.spans, text.indexOf("42"))!;
    expect(text.slice(r.start, r.end)).toBe("42");
  });

  it("selects a negative / exponential number whole", () => {
    const text = `{"n":-1.5e3}`;
    const p = parseWithSpans(text)!;
    const r = valueSelectionAt(p.tree, p.spans, text.indexOf("-1.5e3") + 1)!;
    expect(text.slice(r.start, r.end)).toBe("-1.5e3");
  });

  it("selects the whole token of a boolean", () => {
    const text = `{"b":true}`;
    const p = parseWithSpans(text)!;
    const r = valueSelectionAt(p.tree, p.spans, text.indexOf("true"))!;
    expect(text.slice(r.start, r.end)).toBe("true");
  });

  it("selects the whole token of null", () => {
    const text = `{"x":null}`;
    const p = parseWithSpans(text)!;
    const r = valueSelectionAt(p.tree, p.spans, text.indexOf("null"))!;
    expect(text.slice(r.start, r.end)).toBe("null");
  });

  it("returns an empty range between the quotes for an empty string", () => {
    const text = `{"k":""}`;
    const p = parseWithSpans(text)!;
    const off = text.indexOf(`""`) + 1; // between the two quotes
    const r = valueSelectionAt(p.tree, p.spans, off)!;
    expect(r.start).toBe(r.end);
    expect(text.slice(r.start, r.end)).toBe("");
  });

  it("returns null when the click lands on a key (innermost span is the object)", () => {
    const text = `{"name":"Ada"}`;
    const p = parseWithSpans(text)!;
    expect(valueSelectionAt(p.tree, p.spans, text.indexOf("name"))).toBeNull();
  });

  it("returns null for an object value", () => {
    const text = `{"o":{"a":1}}`;
    const p = parseWithSpans(text)!;
    expect(valueSelectionAt(p.tree, p.spans, text.indexOf(`{"a"`))).toBeNull();
  });

  it("selects a nested value", () => {
    const text = `{"o":{"a":"deep"}}`;
    const p = parseWithSpans(text)!;
    const r = valueSelectionAt(p.tree, p.spans, text.indexOf("deep"))!;
    expect(text.slice(r.start, r.end)).toBe("deep");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/features/bodyview/selectValue.test.ts`
Expected: FAIL — cannot resolve `./selectValue` / `valueSelectionAt` is not a function.

- [ ] **Step 3: Write minimal implementation**

Create `src/features/bodyview/selectValue.ts`:

```ts
import type { JsonTree } from "./jsonTree";
import { spanAtOffset, type ValueSpan } from "./spans";

export interface SelectionRange {
  start: number; // inclusive char offset
  end: number;   // exclusive char offset
}

/** Char-offset range to select when the user double-clicks the value at `offset`.
 *  Strings → inner text (quotes excluded) so a retype stays valid JSON; other
 *  scalars → the whole token. Containers / keys / structural punctuation → null
 *  (the innermost span is an object/array, or no span contains the offset), so the
 *  caller leaves Monaco's default word-select in place. */
export function valueSelectionAt(
  tree: JsonTree,
  spans: readonly ValueSpan[],
  offset: number,
): SelectionRange | null {
  const span = spanAtOffset(spans, offset);
  if (!span) return null;
  const node = tree.nodes[span.nodeId];
  if (!node) return null;
  switch (node.kind) {
    case "string":
      return { start: span.start + 1, end: span.end - 1 };
    case "number":
    case "boolean":
    case "null":
      return { start: span.start, end: span.end };
    default:
      return null; // object / array
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test src/features/bodyview/selectValue.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 5: Commit**

```bash
git add src/features/bodyview/selectValue.ts src/features/bodyview/selectValue.test.ts
git commit -m "feat(bodyview): valueSelectionAt — offset range for value double-click"
```

---

### Task 2: Double-click branch in the body controller

**Files:**
- Modify: `src/features/bodyview/editorLike.ts:10-13`
- Modify: `src/features/bodyview/controller.ts`
- Test: `src/features/bodyview/controller.test.ts`

- [ ] **Step 1: Extend the event type with modifier keys**

In `src/features/bodyview/editorLike.ts`, replace the `EditorMouseEventLike` interface (lines 10-13) with:

```ts
export interface EditorMouseEventLike {
  event: { ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean; detail: number; browserEvent: { preventDefault(): void } };
  target: { element: HTMLElement | null; position: PositionLike | null };
}
```

- [ ] **Step 2: Update the fake editor's event defaults (keeps existing tests compiling)**

In `src/features/bodyview/controller.test.ts`, the `fire` helper builds the event. Update its default literal (line ~23) to include the new modifiers:

```ts
    handler?.({
      event: { ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, detail: 1, browserEvent: { preventDefault: vi.fn() }, ...ev },
      target: { element, position: { lineNumber: 1, column: offset + 1 } },
    });
```

- [ ] **Step 3: Write the failing tests for the new branch**

In `src/features/bodyview/controller.test.ts`, add inside the `describe("attachBodyController", ...)` block:

```ts
  it("selects the value on a plain double-click", () => {
    const text = `{"name":"hello world"}`;
    const parsed = parseWithSpans(text)!;
    const onSelectValue = vi.fn();
    const { editor, fire } = fakeEditor(text);
    attachBodyController(editor, { getTree: () => parsed.tree, getSpans: () => parsed.spans, onSelectValue });
    fire(text.indexOf("hello"), { detail: 2 });
    expect(onSelectValue).toHaveBeenCalledTimes(1);
    const range = onSelectValue.mock.calls[0][0];
    expect(text.slice(range.start, range.end)).toBe("hello world");
  });

  it("does not select a value on Shift or Alt double-click", () => {
    const text = `{"name":"hello world"}`;
    const parsed = parseWithSpans(text)!;
    const onSelectValue = vi.fn();
    const { editor, fire } = fakeEditor(text);
    attachBodyController(editor, { getTree: () => parsed.tree, getSpans: () => parsed.spans, onSelectValue });
    fire(text.indexOf("hello"), { detail: 2, shiftKey: true });
    fire(text.indexOf("hello"), { detail: 2, altKey: true });
    expect(onSelectValue).not.toHaveBeenCalled();
  });

  it("does not select on a double-click that lands on a key", () => {
    const text = `{"name":"Ada"}`;
    const parsed = parseWithSpans(text)!;
    const onSelectValue = vi.fn();
    const { editor, fire } = fakeEditor(text);
    attachBodyController(editor, { getTree: () => parsed.tree, getSpans: () => parsed.spans, onSelectValue });
    fire(text.indexOf("name"), { detail: 2 });
    expect(onSelectValue).not.toHaveBeenCalled();
  });
```

- [ ] **Step 4: Run tests to verify they fail**

Run: `pnpm test src/features/bodyview/controller.test.ts`
Expected: FAIL — `onSelectValue` is not in `BodyControllerDeps` (type error) and/or the new branch doesn't exist so the first new test fails (`onSelectValue` never called).

- [ ] **Step 5: Add the dep and the branch**

In `src/features/bodyview/controller.ts`:

Add the import near the top (after the existing imports):

```ts
import { valueSelectionAt, type SelectionRange } from "./selectValue";
```

Add the dep to `BodyControllerDeps` (after `onBadgeExpand?`):

```ts
  /** Plain (no-modifier) double-click selects the whole value at the offset so the
   *  user can type a replacement; request editor only. Receives the char-offset
   *  range to select (caller turns it into a Monaco selection). */
  onSelectValue?: (range: SelectionRange) => void;
```

Inside `onMouseDown`, after the Ctrl/Cmd copy block (the `if ((e.event.ctrlKey || e.event.metaKey) && e.event.detail === 2) { ... }` block) and before the closing `});`, add:

```ts
    // Plain double-click → select the whole value (inner text for strings) so the
    // user can type a replacement. Modifier double-clicks are reserved: Ctrl/Cmd =
    // copy (above), Shift/Alt = Monaco's own gestures — so require no modifiers.
    if (
      deps.onSelectValue &&
      e.event.detail === 2 &&
      !e.event.ctrlKey && !e.event.metaKey && !e.event.altKey && !e.event.shiftKey
    ) {
      const tree = deps.getTree();
      if (!tree) return;
      const range = valueSelectionAt(tree, deps.getSpans(), offset);
      if (range) {
        e.event.browserEvent.preventDefault();
        deps.onSelectValue(range);
      }
    }
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `pnpm test src/features/bodyview/controller.test.ts`
Expected: PASS — all prior tests (incl. "copies on Ctrl+double-click", "ignores a plain double-click (no modifier)" — which passes no `onSelectValue`, so the branch self-skips) plus the 3 new ones.

- [ ] **Step 7: Commit**

```bash
git add src/features/bodyview/editorLike.ts src/features/bodyview/controller.ts src/features/bodyview/controller.test.ts
git commit -m "feat(bodyview): plain double-click selects value via onSelectValue dep"
```

---

### Task 3: Wire it in BodyView (request only)

**Files:**
- Modify: `src/features/bodyview/BodyView.tsx` (the `badgeNodeIdAt`/`expandNode` helper area and the `attachBodyController` call at ~355-360)

> No new unit test: this is Monaco onMount glue (`setSelection`, `Selection`, `getPositionAt`) — the codebase verifies such wiring via tsc/build + a live WebView2 pass (mirrors decode/fold/word-wrap attach). The behavior core is already unit-tested in Tasks 1–2.

- [ ] **Step 1: Add the request-only selection helper**

In `src/features/bodyview/BodyView.tsx`, add this helper next to `expandNode` (after the `expandNode` function, ~line 151), importing nothing new (uses `live`, `queueMicrotask`, and `l.monaco`):

```ts
  // Request only: turn a double-click value-selection range (char offsets) into a
  // Monaco selection. Deferred to a microtask so it lands AFTER Monaco finishes its
  // own double-click word-select — otherwise Monaco's selection clobbers ours.
  const selectValueRange = (range: { start: number; end: number }) => {
    const l = live.current;
    const model = l?.editor.getModel();
    if (!l || !model) return;
    queueMicrotask(() => {
      const s = model.getPositionAt(range.start);
      const e = model.getPositionAt(range.end);
      l.editor.setSelection(new l.monaco.Selection(s.lineNumber, s.column, e.lineNumber, e.column));
    });
  };
```

- [ ] **Step 2: Pass it to the controller (request mode only)**

In `src/features/bodyview/BodyView.tsx`, update the `attachBodyController` call (~line 355) to add the `onSelectValue` line:

```ts
      live.current.controller = attachBodyController(editor, {
        getTree: () => live.current?.tree ?? null,
        getSpans: () => live.current?.spans ?? [],
        getBadgeNodeIdAt: mode === "response" ? badgeNodeIdAt : undefined,
        onBadgeExpand: mode === "response" ? expandNode : undefined,
        onSelectValue: mode === "request" ? selectValueRange : undefined,
      });
```

- [ ] **Step 3: Verify types + full unit suite**

Run: `pnpm lint`
Expected: PASS (no type errors — `l.monaco.Selection` and `editor.setSelection` are valid Monaco APIs).

Run: `pnpm test`
Expected: PASS — baseline + new tests (no regressions in `BodyView.*.test.tsx`).

- [ ] **Step 4: Verify the production build**

Run: `pnpm build`
Expected: PASS (tsc -b + vite build).

- [ ] **Step 5: Commit**

```bash
git add src/features/bodyview/BodyView.tsx
git commit -m "feat(bodyview): request editor selects value on double-click"
```

---

### Task 4: Live verification + finish

- [ ] **Step 1: Run the full gate once more**

Run: `pnpm test && pnpm lint && pnpm build`
Expected: all green. Record the vitest count.

- [ ] **Step 2: Live WebView2 pass** (`pnpm tauri:dev`), in the request body editor:
  - Double-click a long multi-word string value (e.g. `"hello world, foo"`) → the whole inner text (no quotes) is selected; typing replaces it cleanly and the JSON stays valid.
  - Double-click a number / `true` / `null` → the whole token is selected; typing replaces it.
  - Double-click an empty string `""` → caret lands between the quotes.
  - Double-click a key, an object `{`, or `[` → unchanged (Monaco default word-select).
  - **Ctrl/Cmd**+double-click a value → still copies (unchanged).
  - Open a method whose body is mid-edited/invalid → double-click silently falls back to default (no crash).
  - Switch to the **response** viewer → double-click behavior unchanged (word-select; Ctrl+dblclick copies).

- [ ] **Step 3: Finish** — use `superpowers:finishing-a-development-branch`: ff-merge the `claude/*` branch into `main`; update the **Active work** section of `CLAUDE.md` (new «Последняя влитая»); then archive the plan+spec per `.claude/rules/archiving-completed-work.md` (`git mv` to `archive/`, commit `docs(archive): body-value-dblclick-select plan+spec`).

---

## Self-review

**Spec coverage:**
- String → inner text → Task 1 (`case "string"` → `[start+1, end-1]`) + Task 4 live. ✓
- number/bool/null → whole token → Task 1 + tests. ✓
- object/array/key/punctuation → no-op → Task 1 (`default` → null; key returns object span → null) + Task 2 test. ✓
- Ctrl/Cmd unchanged; Shift/Alt unchanged → Task 2 branch guard + tests. ✓
- Request only; response unchanged → Task 3 (`mode === "request"` gate) + Task 4 live. ✓
- Mid-edit invalid → empty spans → fallback → Task 2 (`getSpans()` empty → `spanAtOffset` null → range null) + Task 4 live. ✓
- No backend/IPC/bindings; no user-facing strings → no `messages.ts` change. ✓

**Placeholder scan:** none — every step has concrete code/commands.

**Type consistency:** `valueSelectionAt`/`SelectionRange` defined in Task 1, imported in Task 2; `onSelectValue: (range: SelectionRange) => void` in Task 2 matches `selectValueRange` (structurally `{ start; end }`) in Task 3. Fake-event default updated in Task 2 to match the widened `EditorMouseEventLike`. ✓
