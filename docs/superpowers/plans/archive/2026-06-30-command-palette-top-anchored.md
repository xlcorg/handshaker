# Command Palette Top-Anchored Positioning — Implementation Plan

> **Статус:** 🎉 DONE — Task 1 реализован, гейт зелёный (vitest **1175** · `tsc -b` · `vite build`),
> spec+quality ревью = APPROVED. Ребейз на `main` (`e2e1691`) + squash 4 коммитов + ff в `main`.
> **Live-verified в WebView2 (2026-06-30).**

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pin the command palette near the top of the viewport so the result list grows downward only and the input stops jumping up-and-down as results fill (instead of the dialog growing from its vertical center).

**Architecture:** Pure-frontend, single file. The palette uses the shared `Dialog`, whose `DialogContent` is vertically centered (`top-[50%] translate-y-[-50%]`). Override those two utilities locally on the palette's `DialogContent` (`top-[12vh] translate-y-0`) and cap the list height relative to the viewport on the palette's `CommandList` (`max-h-[min(360px,60vh)]`). `cn = twMerge(clsx)` so the last class in each conflicting group wins — base values are dropped, not merged. The shared `dialog.tsx` and `command.tsx` are not touched.

**Tech Stack:** TypeScript, React, Vitest, Tailwind (twMerge). No backend / IPC / bindings changes.

**Spec:** `docs/superpowers/specs/2026-06-30-command-palette-top-anchored-design.md`

---

### Task 1: Pin the palette to the top of the viewport

**Files:**
- Modify: `src/features/catalog/CommandPalette.tsx:199` (DialogContent className) and `:224` (CommandList)
- Test: `src/features/catalog/CommandPalette.test.tsx` (add one test)

**Context for the engineer:**
- The palette renders a shadcn `Dialog`. `DialogContent` (`src/components/ui/dialog.tsx`) composes classes with `cn(BASE, className)` where `cn = twMerge(clsx(...))` (`src/lib/cn.ts`). The base string contains `top-[50%] left-[50%] translate-x-[-50%] translate-y-[-50%]`. Passing `top-[12vh] translate-y-0` in the palette's `className` makes twMerge drop the conflicting base `top-[50%]` and `translate-y-[-50%]` (each is a single utility group: `top-*`, `translate-y-*`), keeping horizontal centering (`left-[50%] translate-x-[-50%]`) intact.
- `CommandList` (`src/components/ui/command.tsx`) has a base `max-h-[360px]`. Passing `max-h-[min(360px,60vh)]` overrides it (same `max-h-*` group).
- `DialogContent` and `CommandList` set `data-slot="dialog-content"` / `data-slot="command-list"`. Radix renders the dialog into a portal, so the test queries `document`, not the `render` container (the existing palette tests use `screen`, which also queries `document.body`).
- This is a CSS-only change, so the test asserts the override classes actually landed on the DOM nodes (i.e. twMerge resolved the conflict in our favor) — including that the base centered classes are gone.
- No new user-facing strings — the ui-strings rule does not apply.

- [ ] **Step 1: Write the failing test**

In `src/features/catalog/CommandPalette.test.tsx`, add this test inside the existing `describe("CommandPalette", …)` block (it uses the file's existing `setup()` helper):

```tsx
  it("anchors near the top and grows downward (not vertically centered)", () => {
    setup();
    const content = document.querySelector('[data-slot="dialog-content"]');
    expect(content).not.toBeNull();
    const cls = content!.className;
    // Pinned to the top, vertical centering removed.
    expect(cls).toContain("top-[12vh]");
    expect(cls).toContain("translate-y-0");
    expect(cls).not.toContain("top-[50%]");
    expect(cls).not.toContain("translate-y-[-50%]");
    // Horizontal centering preserved.
    expect(cls).toContain("translate-x-[-50%]");

    const list = document.querySelector('[data-slot="command-list"]');
    expect(list).not.toBeNull();
    const listCls = list!.className;
    expect(listCls).toContain("max-h-[min(360px,60vh)]");
    expect(listCls).not.toContain("max-h-[360px]");
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test src/features/catalog/CommandPalette.test.tsx`

Expected: FAIL on the new test. The current `DialogContent` is vertically centered, so `cls` contains `top-[50%]` and `translate-y-[-50%]` and lacks `top-[12vh]`/`translate-y-0`; the `CommandList` still has `max-h-[360px]` and lacks `max-h-[min(360px,60vh)]`. (Existing palette tests stay green.)

- [ ] **Step 3: Apply the override on the DialogContent**

In `src/features/catalog/CommandPalette.tsx`, change the `DialogContent` className (line ~199). Before:

```tsx
      <DialogContent
        showCloseButton={false}
        className="overflow-hidden gap-0 p-0 sm:max-w-xl"
      >
```

After:

```tsx
      <DialogContent
        showCloseButton={false}
        className="top-[12vh] translate-y-0 overflow-hidden gap-0 p-0 sm:max-w-xl"
      >
```

- [ ] **Step 4: Cap the list height on the CommandList**

In the same file, change the `CommandList` (line ~224). Before:

```tsx
            <CommandList>
```

After:

```tsx
            <CommandList className="max-h-[min(360px,60vh)]">
```

Leave everything else in the file unchanged.

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm test src/features/catalog/CommandPalette.test.tsx`
Expected: PASS — the new test and all existing palette tests green.

- [ ] **Step 6: Run the full gate**

Run: `pnpm test`
Expected: PASS — full vitest suite green (no other test asserted the palette's positioning classes).

Run: `pnpm build`
Expected: PASS — `tsc -b` reports no errors and `vite build` completes (the pre-existing chunk-size warning is benign).

- [ ] **Step 7: Commit**

```bash
git add src/features/catalog/CommandPalette.tsx src/features/catalog/CommandPalette.test.tsx
git commit -m "feat(palette): pin to top of viewport, grow downward only

Override the shared Dialog's vertical centering on the palette only
(top-[12vh] translate-y-0) and cap the list at min(360px,60vh) so the input
stays put and results grow/scroll downward instead of expanding up-and-down
from the center. Shared dialog.tsx/command.tsx untouched.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:**
- Decision 1/3 (pin to top; `top-[12vh] translate-y-0`, keep horizontal centering) → Task 1, Step 3 + test assertions.
- Decision 2/6 (local override on the palette only; shared `dialog.tsx`/`command.tsx` untouched) → Steps 3–4 modify only `CommandPalette.tsx`.
- Decision 4 (list cap `max-h-[min(360px,60vh)]`) → Step 4 + test assertion.
- Decision 5 (grow downward, no reserved empty height) → no extra height reserved; nothing added beyond the cap.
- Spec test plan (override classes present on DOM nodes; base centered classes gone) → Step 1 test.
- Spec gate (`pnpm test` · `tsc -b` · `vite build`) → Steps 5–6.
- Spec risk (twMerge must beat the base) → Step 1 asserts absence of `top-[50%]`/`translate-y-[-50%]`/bare `max-h-[360px]`.

**Placeholder scan:** No TBD/TODO; every code step shows full before/after; every command has expected output.

**Type consistency:** `setup()` is the existing helper in `CommandPalette.test.tsx`; `data-slot` attribute values match those set in `dialog.tsx`/`command.tsx`. No new symbols introduced. `max-h-[min(360px,60vh)]` does not contain the substring `max-h-[360px]`, so the `not.toContain` assertion is valid.
