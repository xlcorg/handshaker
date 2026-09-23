# Resizable request/response body panes + scrollbar fix — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Status:** 🎉 DONE — фича влита в `main` и живёт в продукте: `CallPanel`
> рендерит `ResizablePanelGroup` с ориентацией из `prefs.split` и персистом
> `prefs.bodyPanel` (верифицировано по коду при архивации 2026-06-12; чекбоксы
> задач в этом файле не проставлялись по ходу исполнения).

**Goal:** Make the draft Focus-view request/response panes drag-resizable with a persisted divider and a working left/right ↔ top/bottom toggle, and stop native scrollbars leaking into the request body pane on resize.

**Architecture:** Replace the fixed 50/50 `flex` row in `CallPanel` with the shadcn `ResizablePanelGroup`/`ResizableHandle` (the same `react-resizable-panels` v4 wrapper already used for the sidebar). Orientation comes from the previously-dead `prefs.split`; divider position is a new persisted `prefs.bodyPanel` percent. The scrollbar bug is fixed by scoping `overflow` per request-tab so Monaco (which scrolls itself via `automaticLayout`) is never wrapped in `overflow-auto`.

**Tech Stack:** React 18, TypeScript, Tailwind, `react-resizable-panels@^4` (via `@/components/ui/resizable`), Vitest + Testing Library.

**Spec:** [docs/superpowers/specs/2026-06-08-resizable-body-panes-design.md](../specs/2026-06-08-resizable-body-panes-design.md)

---

## Setup (fresh worktree — do once before Task 1)

This worktree has no `node_modules`. Run before any test/build:

```bash
pnpm install
```

Verify the baseline is green before changing anything:

```bash
pnpm test
```
Expected: all existing suites PASS (the project has ~530 passing tests).

---

## File map

| File | Responsibility | Change |
|------|----------------|--------|
| `src/lib/use-prefs.ts` | Persisted UI prefs | Add `bodyPanel`; change `split` default to `"vertical"` |
| `src/lib/use-prefs.test.ts` | Prefs unit tests | Add `bodyPanel` + `split`-default cases |
| `src/features/workflow/RequestTabs.tsx` | Request tab body container | Scope `overflow` per-tab (bug fix) |
| `src/features/workflow/RequestTabs.test.tsx` | RequestTabs tests | Add overflow-scoping cases |
| `src/features/response/ResponseBody.tsx` | Response Monaco wrapper | `overflow-hidden` (symmetry under resize) |
| `src/features/workflow/CallPanel.tsx` | request/response split | `flex` → `ResizablePanelGroup`; consume `prefs`/`setPref` |
| `src/features/workflow/CallPanel.layout.test.tsx` | New | Resizable structure + orientation mapping |

---

## Task 1: Add `bodyPanel` pref and fix the `split` default

**Files:**
- Modify: `src/lib/use-prefs.ts` (interface `Prefs`, const `PREFS_DEFAULTS`)
- Test: `src/lib/use-prefs.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/use-prefs.test.ts`:

```ts
describe("prefs bodyPanel", () => {
  beforeEach(() => localStorage.clear());

  it("defaults bodyPanel to 50 (percent of the call panel)", () => {
    expect(PREFS_DEFAULTS.bodyPanel).toBe(50);
  });

  it("merges a persisted bodyPanel over defaults", () => {
    const merged = { ...PREFS_DEFAULTS, bodyPanel: 35 };
    expect(merged.bodyPanel).toBe(35);
    expect(typeof readPrefs().bodyPanel).toBe("number");
  });
});

describe("prefs split default", () => {
  it("defaults split to 'vertical' (Left / Right) to preserve current layout", () => {
    expect(PREFS_DEFAULTS.split).toBe("vertical");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run src/lib/use-prefs.test.ts`
Expected: FAIL — `bodyPanel` is `undefined`; `split` default is currently `"horizontal"`.

- [ ] **Step 3: Implement the pref changes**

In `src/lib/use-prefs.ts`, add to the `Prefs` interface (after `sidebarPanel`, near line 18):

```ts
  /** Request body pane size as a percent of the call panel (resizable, persisted).
   *  Clamped to [20, 80] by the ResizablePanel. Shared across split orientations. */
  bodyPanel: number;
```

In `PREFS_DEFAULTS`, change the `split` line and add `bodyPanel`:

```ts
  sidebarPanel: 18,
  bodyPanel: 50,
  split: "vertical",
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm vitest run src/lib/use-prefs.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/use-prefs.ts src/lib/use-prefs.test.ts
git commit -m "feat(prefs): add bodyPanel split size; default split to Left/Right"
```

---

## Task 2: Scope `overflow` per request tab (scrollbar bug fix)

**Files:**
- Modify: `src/features/workflow/RequestTabs.tsx:32-36`
- Test: `src/features/workflow/RequestTabs.test.tsx`

**Why:** The shared `overflow-auto` container wraps the Monaco editor, which already
scrolls itself (`automaticLayout`). On panel resize Monaco's layout lags a frame, so
the editor briefly exceeds the shrunken container and `overflow-auto` paints native
scrollbars. Monaco must sit in `overflow-hidden`; only the plain-DOM Metadata/Auth
tabs need their own scroll.

- [ ] **Step 1: Write the failing tests**

Add these cases inside the `describe("RequestTabs", …)` block in
`src/features/workflow/RequestTabs.test.tsx`:

```ts
it("does not wrap the Monaco request tab in overflow-auto (scrollbar bug)", () => {
  const p = setup();
  render(<RequestTabs {...p} />);
  const container = screen.getByTestId("body-editor").parentElement!;
  expect(container.className).toContain("overflow-hidden");
  expect(container.className).not.toContain("overflow-auto");
});

it("gives the Metadata tab its own scroll wrapper", async () => {
  const user = userEvent.setup();
  const p = setup();
  render(<RequestTabs {...p} />);
  await user.click(screen.getByRole("tab", { name: /metadata/i }));
  expect(screen.getByLabelText("metadata-key-0").closest(".overflow-auto")).not.toBeNull();
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run src/features/workflow/RequestTabs.test.tsx`
Expected: FAIL — the current container has `overflow-auto`; the metadata tab has no `overflow-auto` wrapper.

- [ ] **Step 3: Implement the overflow scoping**

Replace the tab-body block in `src/features/workflow/RequestTabs.tsx` (currently
lines 32-36):

```tsx
      <div className="min-h-0 flex-1 overflow-hidden">
        {tab === "request" ? <BodyEditor value={step.requestJson} onChange={onBody} /> : null}
        {tab === "metadata" ? (
          <div className="h-full overflow-auto">
            <MetadataEditor rows={step.metadata} onChange={onMetadata} />
          </div>
        ) : null}
        {tab === "auth" ? (
          <div className="h-full overflow-auto">
            <AuthReadOnly auth={serviceAuth} />
          </div>
        ) : null}
      </div>
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm vitest run src/features/workflow/RequestTabs.test.tsx`
Expected: PASS (all cases, including the pre-existing ones).

- [ ] **Step 5: Commit**

```bash
git add src/features/workflow/RequestTabs.tsx src/features/workflow/RequestTabs.test.tsx
git commit -m "fix(requesttabs): scope overflow per tab so Monaco isn't double-scrolled"
```

---

## Task 3: `overflow-hidden` on the response Monaco wrapper

**Files:**
- Modify: `src/features/response/ResponseBody.tsx:10`

**Why:** Once the response pane is also resizable (Task 4), the same Monaco layout-lag
could leak a native scrollbar there. Monaco scrolls itself; clip the wrapper.

- [ ] **Step 1: Implement the change**

In `src/features/response/ResponseBody.tsx`, change the wrapper class on line 10:

```tsx
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <BodyView mode="response" value={json} />
    </div>
```

- [ ] **Step 2: Run the response suite to verify nothing breaks**

Run: `pnpm vitest run src/features/response`
Expected: PASS (no behavior change asserted here; this is a layout-only tweak verified manually).

- [ ] **Step 3: Commit**

```bash
git add src/features/response/ResponseBody.tsx
git commit -m "fix(responsebody): clip Monaco wrapper so resize can't leak scrollbars"
```

---

## Task 4: Resizable request/response split with orientation from `prefs.split`

**Files:**
- Modify: `src/features/workflow/CallPanel.tsx` (imports + the `return` of `CallPanel`, lines 75-87)
- Test: `src/features/workflow/CallPanel.layout.test.tsx` (new)

- [ ] **Step 1: Write the failing tests**

Create `src/features/workflow/CallPanel.layout.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";

vi.mock("@/features/invoke/BodyEditor", () => ({
  BodyEditor: ({ value }: { value: string }) => <div data-testid="body-editor">{value}</div>,
}));
vi.mock("@/ipc/client", () => ({
  authResolve: vi.fn().mockResolvedValue(null),
  grpcDescribe: vi.fn().mockResolvedValue({ services: [] }),
  grpcRefreshContract: vi.fn().mockResolvedValue({ services: [] }),
  grpcBuildRequestSkeleton: vi.fn().mockResolvedValue("{}"),
  varsResolve: vi.fn(),
  grpcInvokeOneshot: vi.fn(),
  grpcCancel: vi.fn(),
}));

// Mutable prefs the mock reads; flip `split` per test (vi.hoisted so the
// factory can reference it despite hoisting).
const h = vi.hoisted(() => ({ split: "vertical" as "horizontal" | "vertical" }));
vi.mock("@/lib/use-prefs", () => ({
  usePrefs: () => [{ split: h.split, bodyPanel: 50, theme: "dark" }, vi.fn()],
  readPrefs: () => ({ split: h.split, bodyPanel: 50, theme: "dark" }),
}));

import { CallPanel } from "./CallPanel";
import { newStep } from "./model";

const draft = newStep({ address: "h:443", tls: true, service: "p.v1.S", method: "GetX" });

beforeEach(() => {
  h.split = "vertical";
  vi.clearAllMocks();
});

describe("CallPanel body layout", () => {
  it("renders a resizable group with request + response panels and a handle", () => {
    const { container } = render(<CallPanel step={draft} onPatch={() => {}} />);
    expect(container.querySelector('[data-slot="resizable-panel-group"]')).not.toBeNull();
    expect(container.querySelectorAll('[data-slot="resizable-panel"]').length).toBe(2);
    expect(container.querySelector('[data-slot="resizable-handle"]')).not.toBeNull();
  });

  // The react-resizable-panels v4 fork reflects orientation via the group's
  // inline `flex-direction` style ("row" = horizontal, "column" = vertical) —
  // NOT via aria-orientation/data-orientation (verified against the installed fork).
  it("maps split='vertical' (Left/Right) to a row-direction (horizontal) group", () => {
    const { container } = render(<CallPanel step={draft} onPatch={() => {}} />);
    const group = container.querySelector('[data-slot="resizable-panel-group"]') as HTMLElement;
    expect(group.style.flexDirection).toBe("row");
  });

  it("maps split='horizontal' (Top/Bottom) to a column-direction (vertical) group", () => {
    h.split = "horizontal";
    const { container } = render(<CallPanel step={draft} onPatch={() => {}} />);
    const group = container.querySelector('[data-slot="resizable-panel-group"]') as HTMLElement;
    expect(group.style.flexDirection).toBe("column");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run src/features/workflow/CallPanel.layout.test.tsx`
Expected: FAIL — `CallPanel` still renders a plain `flex` div, so no `data-slot="resizable-*"` nodes exist.

- [ ] **Step 3: Implement the resizable split**

In `src/features/workflow/CallPanel.tsx`, add imports near the top (after the existing
`import` lines):

```tsx
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from "@/components/ui/resizable";
import { usePrefs } from "@/lib/use-prefs";
```

Inside `CallPanel`, add the prefs hook and orientation calc at the start of the
function body (just above `const onBody = …`):

```tsx
  const [prefs, setPref] = usePrefs();
  // prefs.split is our own convention ("horizontal" = a horizontal divider = Top/Bottom);
  // react-resizable-panels uses the inverse ("horizontal" = side-by-side), so flip it.
  const orientation = prefs.split === "horizontal" ? "vertical" : "horizontal";
```

Replace the body `return`'s two-pane block (currently lines 75-87) with:

```tsx
  return (
    <div className="flex h-full flex-col">
      {header}
      <ResizablePanelGroup
        key={orientation}
        orientation={orientation}
        className="min-h-0 flex-1"
        defaultLayout={{ request: prefs.bodyPanel, response: 100 - prefs.bodyPanel }}
        onLayoutChanged={(layout) => {
          const pct = layout["request"];
          if (typeof pct === "number" && pct > 0) setPref("bodyPanel", pct);
        }}
      >
        <ResizablePanel id="request" minSize="20%">
          <RequestTabs step={step} serviceAuth={step.auth} onBody={onBody} onMetadata={onMetadata} />
        </ResizablePanel>
        <ResizableHandle withHandle />
        <ResizablePanel id="response" minSize="20%">
          <div className="flex h-full min-h-0 flex-col">
            <ResponseSlot step={step} />
          </div>
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  );
```

Notes for the implementer:
- The old `border-r border-border` divider is removed — the `ResizableHandle`'s 1px
  `bg-border` is the divider now.
- `key={orientation}` remounts the group on a Top/Bottom ↔ Left/Right toggle so it
  re-reads `defaultLayout` cleanly instead of carrying stale internal sizes.
- `RequestTabs` already renders `h-full flex-col`; the response side gets an explicit
  `flex h-full min-h-0 flex-col` wrapper (replacing the old `min-w-0 flex-1`).

- [ ] **Step 4: Run the new tests to verify they pass**

Run: `pnpm vitest run src/features/workflow/CallPanel.layout.test.tsx`
Expected: PASS (all three cases).

- [ ] **Step 5: Run the existing CallPanel suite to confirm no regression**

Run: `pnpm vitest run src/features/workflow/CallPanel.editable.test.tsx`
Expected: PASS — the editable header and AddressBar tests are unaffected (the real
`usePrefs` is used there; default `split="vertical"` → horizontal orientation).

- [ ] **Step 6: Commit**

```bash
git add src/features/workflow/CallPanel.tsx src/features/workflow/CallPanel.layout.test.tsx
git commit -m "feat(callpanel): drag-resizable request/response split wired to prefs.split"
```

---

## Task 5: Full verification

- [ ] **Step 1: Lint (typecheck)**

Run: `pnpm lint`
Expected: PASS (no type errors; `tsc -b`).

- [ ] **Step 2: Full test suite**

Run: `pnpm test`
Expected: PASS — all suites green, including the new `bodyPanel`, RequestTabs overflow,
and CallPanel layout cases.

- [ ] **Step 3: Build the web bundle**

Run: `pnpm build`
Expected: PASS (`tsc -b && vite build` produces `dist/`).

- [ ] **Step 4: Manual visual pass (human, `pnpm tauri:dev`)**

jsdom cannot measure layout or drag, so confirm by hand:
- Drag the **sidebar** divider → **no native scrollbars** appear in the request body
  pane (the reported bug is gone).
- Drag the **request/response** divider → both panes resize smoothly; reload the app →
  the divider position is **restored** (`prefs.bodyPanel` persisted).
- Settings → Appearance → **Split direction**: toggle Top/Bottom ↔ Left/Right → the
  request/response panes re-orient accordingly, with no leaked scrollbars after the flip.

---

## Self-review notes

- **Spec coverage:** scrollbar fix (Tasks 2–3), resizable split + persisted `bodyPanel`
  (Tasks 1, 4), `prefs.split` → orientation with inverse mapping (Task 4), default
  `split` → `"vertical"` (Task 1), manual verification of all three behaviors (Task 5).
- **Type consistency:** new field `bodyPanel: number`; orientation values `"horizontal"`/
  `"vertical"` match the `ResizablePanelGroup` prop and the `aria-orientation` assertion;
  panel ids `"request"`/`"response"` match the `defaultLayout`/`onLayoutChanged` keys.
- **Out of scope (per spec):** per-orientation persisted sizes, pane-to-zero collapse,
  removing the Split direction setting.
