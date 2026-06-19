# Large-response navigation — minimap · scrollbar · collapse-all Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a large gRPC response easy to navigate — an overflow-gated minimap, a grabbable scrollbar, and Collapse-all / Expand-all buttons on the response Body tab.

**Architecture:** Pure frontend. The response body is a read-only Monaco editor (`BodyView mode="response"`). We (1) tune the shared scrollbar options and add an overflow-gated block minimap on the response editor, and (2) expose a tiny `BodyViewHandle { collapseAll, expandAll }` from `BodyView` (forwardRef), wired from two icon buttons in the `ResponsePanel` header through `ResponseBody` — the same header↔content bridge as `SidebarShell` ↔ `CollectionTree`. Folding uses Monaco's built-in `editor.foldAll` / `editor.unfoldAll`. No backend / IPC / bindings change.

**Tech Stack:** React 18, TypeScript, Monaco (`@monaco-editor/react`), Vitest + Testing Library, lucide-react icons, shadcn `Button`.

**Spec:** `docs/superpowers/specs/2026-06-19-large-response-navigation-design.md`

**Test discipline note:** The unit suite mocks `@/lib/monaco` with a stub that does **not** invoke Monaco's `onMount` (see `src/features/bodyview/BodyView.test.tsx:28`). So onMount-internal wiring (the minimap size-gate) and real folding are verified **live in WebView2**, not in jsdom. The unit-testable logic is extracted into pure helpers (`minimapGate.ts`, `foldActions.ts`) and the component glue (handle exposure, button render-gating, click→handle wiring) is tested with mocked editor/handle.

---

## File structure

| File | Responsibility |
|------|----------------|
| `src/features/bodyview/minimapGate.ts` (new) | Pure `shouldShowMinimap(contentHeight, viewportHeight)` predicate |
| `src/features/bodyview/foldActions.ts` (new) | Pure `foldAll(editor)` / `unfoldAll(editor)` over a minimal `FoldableEditor` |
| `src/lib/monaco.ts` (modify) | Scrollbar tuning in `EDITOR_OPTIONS`; block-minimap base in `BODY_READONLY_OPTIONS` |
| `src/features/bodyview/BodyView.tsx` (modify) | `forwardRef` + `BodyViewHandle`; minimap size-gate wiring (response onMount) |
| `src/features/response/ResponseBody.tsx` (modify) | `forwardRef` passthrough of the handle to `BodyView` |
| `src/features/response/ResponsePanel.tsx` (modify) | `bodyRef` + Collapse-all/Expand-all buttons, gated to success+Body+JSON |
| `src/features/response/ResponsePanel.collapse.test.tsx` (new) | Click→handle wiring test (mocked `ResponseBody`) |

---

### Task 1: `shouldShowMinimap` — overflow predicate

**Files:**
- Create: `src/features/bodyview/minimapGate.ts`
- Test: `src/features/bodyview/minimapGate.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/features/bodyview/minimapGate.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { shouldShowMinimap, MINIMAP_OVERFLOW_TOLERANCE } from "./minimapGate";

describe("shouldShowMinimap", () => {
  it("is false when content fits the viewport", () => {
    expect(shouldShowMinimap(300, 600)).toBe(false);
  });

  it("is false when content equals the viewport", () => {
    expect(shouldShowMinimap(600, 600)).toBe(false);
  });

  it("is false for an overflow within the tolerance (no flicker at the boundary)", () => {
    expect(shouldShowMinimap(600 + MINIMAP_OVERFLOW_TOLERANCE, 600)).toBe(false);
  });

  it("is true once content overflows beyond the tolerance", () => {
    expect(shouldShowMinimap(600 + MINIMAP_OVERFLOW_TOLERANCE + 1, 600)).toBe(true);
  });

  it("is true for a clearly larger document", () => {
    expect(shouldShowMinimap(5000, 600)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/features/bodyview/minimapGate.test.ts`
Expected: FAIL — cannot resolve `./minimapGate`.

- [ ] **Step 3: Write minimal implementation**

Create `src/features/bodyview/minimapGate.ts`:

```ts
/** Px of overflow we tolerate before showing the minimap. A 1px overflow as the
 *  layout settles (or a horizontal scrollbar appearing) shouldn't toggle the
 *  strip on and off. */
export const MINIMAP_OVERFLOW_TOLERANCE = 8;

/** Show the response minimap only when the rendered content overflows the
 *  viewport — a short response (or a tall pane) keeps a clean, strip-free editor. */
export function shouldShowMinimap(
  contentHeight: number,
  viewportHeight: number,
  tolerance = MINIMAP_OVERFLOW_TOLERANCE,
): boolean {
  return contentHeight > viewportHeight + tolerance;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/features/bodyview/minimapGate.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/features/bodyview/minimapGate.ts src/features/bodyview/minimapGate.test.ts
git commit -m "feat(response): shouldShowMinimap overflow predicate"
```

---

### Task 2: `foldActions` — fold-all / unfold-all over a minimal editor

**Files:**
- Create: `src/features/bodyview/foldActions.ts`
- Test: `src/features/bodyview/foldActions.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/features/bodyview/foldActions.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { foldAll, unfoldAll, type FoldableEditor } from "./foldActions";

/** A mock editor that records which action id was requested and runs the action. */
function mockEditor() {
  const run = vi.fn();
  const getAction = vi.fn((_id: string) => ({ run }));
  return { editor: { getAction } as FoldableEditor, getAction, run };
}

describe("foldActions", () => {
  it("foldAll runs Monaco's editor.foldAll action", () => {
    const m = mockEditor();
    foldAll(m.editor);
    expect(m.getAction).toHaveBeenCalledWith("editor.foldAll");
    expect(m.run).toHaveBeenCalledTimes(1);
  });

  it("unfoldAll runs Monaco's editor.unfoldAll action", () => {
    const m = mockEditor();
    unfoldAll(m.editor);
    expect(m.getAction).toHaveBeenCalledWith("editor.unfoldAll");
    expect(m.run).toHaveBeenCalledTimes(1);
  });

  it("no-ops safely when the action is unavailable", () => {
    const editor: FoldableEditor = { getAction: () => null };
    expect(() => foldAll(editor)).not.toThrow();
    expect(() => unfoldAll(editor)).not.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/features/bodyview/foldActions.test.ts`
Expected: FAIL — cannot resolve `./foldActions`.

- [ ] **Step 3: Write minimal implementation**

Create `src/features/bodyview/foldActions.ts`:

```ts
/** The slice of the Monaco editor we need to drive folding. Keeps unit tests
 *  free of the full editor (and of importing monaco-editor). `IStandaloneCodeEditor`
 *  satisfies this structurally. */
export interface FoldableEditor {
  getAction(id: string): { run(): unknown } | null | undefined;
}

/** Collapse every foldable region (Monaco built-in). */
export function foldAll(editor: FoldableEditor): void {
  editor.getAction("editor.foldAll")?.run();
}

/** Expand every folded region (Monaco built-in). */
export function unfoldAll(editor: FoldableEditor): void {
  editor.getAction("editor.unfoldAll")?.run();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/features/bodyview/foldActions.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/features/bodyview/foldActions.ts src/features/bodyview/foldActions.test.ts
git commit -m "feat(response): foldAll/unfoldAll helpers over a minimal editor"
```

---

### Task 3: Scrollbar tuning + block-minimap base options

**Files:**
- Modify: `src/lib/monaco.ts:147` (scrollbar in `EDITOR_OPTIONS`)
- Modify: `src/lib/monaco.ts:176-180` (`BODY_READONLY_OPTIONS`)

> **No unit test here, by design.** Importing `src/lib/monaco.ts` kicks off the eager `setupPromise` IIFE (`import("monaco-editor")` + workers) at module load, which the suite deliberately mocks away everywhere. Asserting a literal option value isn't worth executing real Monaco in jsdom. Verified by `tsc`, `vite build`, and the live pass.

- [ ] **Step 1: Widen the scrollbar and enable page-scroll on the trough**

In `src/lib/monaco.ts`, replace the scrollbar line in `EDITOR_OPTIONS` (currently `src/lib/monaco.ts:147`):

```ts
  scrollbar: { verticalScrollbarSize: 8, horizontalScrollbarSize: 8 },
```

with:

```ts
  // 14px vertical bar (VS Code default) is a real mouse target; the thin 8px bar
  // was hard to grab on a big response. scrollByPage: clicking the trough pages by
  // a screenful instead of teleporting — jump-anywhere is covered by the minimap.
  scrollbar: { verticalScrollbarSize: 14, horizontalScrollbarSize: 8, scrollByPage: true },
```

- [ ] **Step 2: Add the block-minimap base to the response editor options**

In `src/lib/monaco.ts`, replace `BODY_READONLY_OPTIONS` (currently `src/lib/monaco.ts:176-180`):

```ts
export const BODY_READONLY_OPTIONS = {
  ...EDITOR_OPTIONS,
  folding: true,
  readOnly: true,
} as const;
```

with:

```ts
export const BODY_READONLY_OPTIONS = {
  ...EDITOR_OPTIONS,
  folding: true,
  readOnly: true,
  // Minimap starts OFF; BodyView (response) flips `enabled` on only when the
  // rendered content overflows the viewport (size-gated, see minimapGate.ts).
  // renderCharacters:false → a clean color-block overview matching the dark theme.
  minimap: { enabled: false, renderCharacters: false },
} as const;
```

- [ ] **Step 3: Verify types and build**

Run: `pnpm exec tsc --noEmit`
Expected: no errors.

Run: `pnpm build`
Expected: vite build succeeds.

- [ ] **Step 4: Commit**

```bash
git add src/lib/monaco.ts
git commit -m "feat(response): widen scrollbar + block-minimap base options"
```

---

### Task 4: `BodyView` — `forwardRef` handle + minimap size-gate

**Files:**
- Modify: `src/features/bodyview/BodyView.tsx`
- Test: `src/features/bodyview/BodyView.test.tsx` (add a handle test)

- [ ] **Step 1: Write the failing test**

In `src/features/bodyview/BodyView.test.tsx`, change the import line (currently line 26):

```ts
import { BodyView } from "./BodyView";
```

to:

```ts
import { createRef } from "react";
import { BodyView, type BodyViewHandle } from "./BodyView";
```

Then add this test inside the `describe("BodyView", ...)` block:

```ts
  it("exposes a collapse/expand handle (no-op before the editor mounts)", () => {
    const ref = createRef<BodyViewHandle>();
    render(<BodyView ref={ref} mode="response" value={`{"a":1}`} />);
    expect(typeof ref.current?.collapseAll).toBe("function");
    expect(typeof ref.current?.expandAll).toBe("function");
    // The Monaco stub never fires onMount, so there is no live editor — the
    // handle must guard and no-op rather than throw.
    expect(() => {
      ref.current?.collapseAll();
      ref.current?.expandAll();
    }).not.toThrow();
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/features/bodyview/BodyView.test.tsx`
Expected: FAIL — `BodyViewHandle` is not exported / `BodyView` does not accept a `ref`.

- [ ] **Step 3: Add imports + the fold helpers + minimap gate to `BodyView.tsx`**

In `src/features/bodyview/BodyView.tsx`, change the first React import (line 1):

```ts
import { Suspense, useCallback, useEffect, useMemo, useRef } from "react";
```

to:

```ts
import { Suspense, forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef } from "react";
```

Add these imports alongside the other `./` imports (e.g. after the `copyDecoded` import on line 23):

```ts
import { foldAll, unfoldAll } from "./foldActions";
import { shouldShowMinimap } from "./minimapGate";
```

- [ ] **Step 4: Extend the `Live` interface with minimap bookkeeping**

In the `Live` interface, after the `lastText: string;` field (line 55), add:

```ts
  /** Whether the minimap is currently enabled (response only) — guards the
   *  size-gate so toggling it never loops with the layout-change listener. */
  minimapOn: boolean;
  /** Disposables for the size-gate listeners (response only). */
  minimapSubs: DisposableLike[];
```

- [ ] **Step 5: Convert `BodyView` to `forwardRef` and export the handle**

Replace the component signature (line 58):

```ts
export function BodyView({ mode, value, onChange, onSubmit, schema }: BodyViewProps) {
```

with:

```ts
export interface BodyViewHandle {
  /** Collapse every foldable region in the body (no-op until the editor mounts). */
  collapseAll(): void;
  /** Expand every folded region. */
  expandAll(): void;
}

export const BodyView = forwardRef<BodyViewHandle, BodyViewProps>(function BodyView(
  { mode, value, onChange, onSubmit, schema },
  ref,
) {
```

And replace the component's closing brace (the final `}` on line 393, immediately after the closing `</Suspense>` return):

```ts
}
```

with:

```ts
});
```

- [ ] **Step 6: Expose the imperative handle**

Immediately after the `schemaRef.current = schema;` line (line 65), add:

```ts
  // Header buttons (ResponsePanel) drive folding through this handle — the same
  // bridge as SidebarShell↔CollectionTree. Guards on the live editor so it no-ops
  // before mount (and in unit tests, where the Monaco stub never fires onMount).
  useImperativeHandle(
    ref,
    () => ({
      collapseAll() {
        const e = live.current?.editor;
        if (e) foldAll(e);
      },
      expandAll() {
        const e = live.current?.editor;
        if (e) unfoldAll(e);
      },
    }),
    [],
  );
```

- [ ] **Step 7: Initialise the new `Live` fields**

In `onMount`, the `live.current = { ... }` initialiser (lines 190-196) currently ends with:

```ts
        lineCount: editor.getModel()?.getLineCount() ?? 1,
        lastText: editor.getValue(),
      };
```

Change it to:

```ts
        lineCount: editor.getModel()?.getLineCount() ?? 1,
        lastText: editor.getValue(),
        minimapOn: false,
        minimapSubs: [],
      };
```

- [ ] **Step 8: Wire the minimap size-gate in the response branch**

In `onMount`, the response branch currently starts (line 234):

```ts
      if (mode === "response") {
        renderResponse(editor.getValue());
```

Insert the size-gate wiring right after `renderResponse(editor.getValue());`:

```ts
      if (mode === "response") {
        renderResponse(editor.getValue());
        // Size-gate the minimap: show it only when content overflows the viewport
        // (short responses / tall panes stay strip-free). Re-evaluate on content
        // growth (badge-expand) and pane resize. The minimapOn guard makes
        // updateOptions a no-op when nothing changed.
        const syncMinimap = () => {
          const l = live.current;
          if (!l) return;
          const want = shouldShowMinimap(l.editor.getContentHeight(), l.editor.getLayoutInfo().height);
          if (want === l.minimapOn) return;
          l.minimapOn = want;
          l.editor.updateOptions({ minimap: { enabled: want, renderCharacters: false } });
        };
        live.current.minimapSubs = [
          editor.onDidContentSizeChange(syncMinimap),
          editor.onDidLayoutChange(syncMinimap),
        ];
        syncMinimap();
```

(The rest of the response branch — `reportSave`, `attachDecodeActions` — stays unchanged below this insertion.)

- [ ] **Step 9: Dispose the minimap listeners on remount and unmount**

In `onMount`, the teardown of the prior mount (lines 185-189) currently is:

```ts
      if (live.current?.ghostTimer != null) window.clearTimeout(live.current.ghostTimer);
      live.current?.ghost?.dispose();
      live.current?.controller?.dispose();
      live.current?.decode?.dispose();
      live.current?.typeSub?.dispose();
```

Add a line for the minimap subs:

```ts
      if (live.current?.ghostTimer != null) window.clearTimeout(live.current.ghostTimer);
      live.current?.ghost?.dispose();
      live.current?.controller?.dispose();
      live.current?.decode?.dispose();
      live.current?.typeSub?.dispose();
      live.current?.minimapSubs?.forEach((d) => d.dispose());
```

And in the unmount `useEffect` (lines 286-292) currently:

```ts
  useEffect(() => () => {
    live.current?.controller?.dispose();
    live.current?.decode?.dispose();
    live.current?.typeSub?.dispose();
    if (live.current?.ghostTimer != null) window.clearTimeout(live.current.ghostTimer);
    live.current?.ghost?.dispose();
  }, []);
```

add the minimap subs disposal:

```ts
  useEffect(() => () => {
    live.current?.controller?.dispose();
    live.current?.decode?.dispose();
    live.current?.typeSub?.dispose();
    if (live.current?.ghostTimer != null) window.clearTimeout(live.current.ghostTimer);
    live.current?.ghost?.dispose();
    live.current?.minimapSubs?.forEach((d) => d.dispose());
  }, []);
```

- [ ] **Step 10: Run the full BodyView suite to verify it passes**

Run: `pnpm vitest run src/features/bodyview/`
Expected: PASS — including the new handle test and the existing `BodyView.test.tsx` / `.ghost` / `.submit` tests (request-mode callers unaffected by `forwardRef`).

- [ ] **Step 11: Verify types**

Run: `pnpm exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 12: Commit**

```bash
git add src/features/bodyview/BodyView.tsx src/features/bodyview/BodyView.test.tsx
git commit -m "feat(response): BodyView forwardRef handle + overflow-gated minimap"
```

---

### Task 5: `ResponseBody` — forward the handle to `BodyView`

**Files:**
- Modify: `src/features/response/ResponseBody.tsx`
- Test: `src/features/response/ResponseBody.test.tsx` (existing — must still pass)

- [ ] **Step 1: Convert `ResponseBody` to `forwardRef` and pass the ref down**

Replace the entire contents of `src/features/response/ResponseBody.tsx`:

```tsx
import { forwardRef } from "react";
import { BodyView, type BodyViewHandle } from "@/features/bodyview/BodyView";

export interface ResponseBodyProps {
  json: string;
}

/** Response-body viewer: read-only Monaco with elision via the shared BodyView.
 *  Right-click a value to decode base64 (copies the decoded text) or save it.
 *  Forwards a `{ collapseAll, expandAll }` handle so the ResponsePanel header
 *  buttons can fold/unfold the body. */
export const ResponseBody = forwardRef<BodyViewHandle, ResponseBodyProps>(function ResponseBody(
  { json },
  ref,
) {
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <BodyView ref={ref} mode="response" value={json} />
    </div>
  );
});
```

- [ ] **Step 2: Run the existing ResponseBody test + typecheck**

Run: `pnpm vitest run src/features/response/ResponseBody.test.tsx`
Expected: PASS (no behavioural change — `forwardRef` is transparent to a ref-less caller).

Run: `pnpm exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/features/response/ResponseBody.tsx
git commit -m "feat(response): forward fold handle through ResponseBody"
```

---

### Task 6: `ResponsePanel` — Collapse-all / Expand-all buttons

**Files:**
- Modify: `src/features/response/ResponsePanel.tsx`
- Test: `src/features/response/ResponsePanel.test.tsx` (add render-gating tests)
- Create: `src/features/response/ResponsePanel.collapse.test.tsx` (click→handle wiring)

- [ ] **Step 1: Write the failing render-gating tests**

In `src/features/response/ResponsePanel.test.tsx`, add this block at the end of the file (it reuses the `ok` and `err` fixtures already defined at the top):

```tsx
describe("ResponsePanel collapse/expand buttons", () => {
  it("shows Collapse all + Expand all on a successful JSON body", () => {
    render(<ResponsePanel state="success" outcome={ok} />);
    expect(screen.getByRole("button", { name: "collapse all" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "expand all" })).toBeInTheDocument();
  });

  it("hides them on the idle empty state", () => {
    render(<ResponsePanel state="idle" outcome={null} />);
    expect(screen.queryByRole("button", { name: "collapse all" })).toBeNull();
  });

  it("hides them on an error response (no JSON tree)", () => {
    render(<ResponsePanel state="error" outcome={err} />);
    expect(screen.queryByRole("button", { name: "collapse all" })).toBeNull();
  });

  it("hides them when a non-Body tab is active", () => {
    render(<ResponsePanel state="success" outcome={ok} />);
    fireEvent.click(screen.getByRole("tab", { name: "Trailers" }));
    expect(screen.queryByRole("button", { name: "collapse all" })).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify the gating tests fail**

Run: `pnpm vitest run src/features/response/ResponsePanel.test.tsx`
Expected: FAIL — the buttons don't exist yet (`Unable to find role="button" name="collapse all"`).

- [ ] **Step 3: Add the buttons + ref wiring to `ResponsePanel.tsx`**

In `src/features/response/ResponsePanel.tsx`:

(a) Change the React import (line 1):

```ts
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
```

to add the icons and Button (keep `useRef`, already present):

```ts
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { ChevronsDownUp, ChevronsUpDown } from "lucide-react";
import { Button } from "@/components/ui/button";
```

(b) Add the handle type import next to the existing `ResponseBody` import (line 4). Leave the `ResponseBody` import line as-is and add a new line after it:

```ts
import { ResponseBody } from "./ResponseBody";
import type { BodyViewHandle } from "@/features/bodyview/BodyView";
```

(c) Inside the component, after the `const [tab, setTab] = useState<ResponseTab>("body");` line (line 33), add the ref and a single gating boolean:

```ts
  const bodyRef = useRef<BodyViewHandle>(null);
```

(d) After the `const sending = state === "sending";` line (line 41), add:

```ts
  // The collapse/expand controls only make sense over the foldable JSON tree —
  // the same condition that renders <ResponseBody> below.
  const showBodyTools = state === "success" && !!outcome && tab === "body" && outcome.response_json !== null;
```

(e) Replace the right-side header cluster (lines 85-87):

```tsx
        <div className="ml-auto flex items-center gap-2.5">
          <RespMeta state={state} outcome={outcome} />
        </div>
```

with:

```tsx
        <div className="ml-auto flex items-center gap-2.5">
          {showBodyTools && (
            <div className="flex items-center gap-1">
              <Button
                size="icon-sm"
                variant="ghost"
                className="size-5 text-muted-foreground"
                aria-label="collapse all"
                title="Collapse all"
                onClick={() => bodyRef.current?.collapseAll()}
              >
                <ChevronsDownUp className="size-3.5" />
              </Button>
              <Button
                size="icon-sm"
                variant="ghost"
                className="size-5 text-muted-foreground"
                aria-label="expand all"
                title="Expand all"
                onClick={() => bodyRef.current?.expandAll()}
              >
                <ChevronsUpDown className="size-3.5" />
              </Button>
            </div>
          )}
          <RespMeta state={state} outcome={outcome} />
        </div>
```

(f) Pass the ref to `<ResponseBody>` in the success-body branch (lines 109-113):

```tsx
      {state === "success" && outcome && tab === "body" && outcome.response_json !== null && (
        <div className="hs-fade-in flex min-h-0 flex-1 flex-col">
          <ResponseBody json={outcome.response_json} />
        </div>
      )}
```

becomes:

```tsx
      {state === "success" && outcome && tab === "body" && outcome.response_json !== null && (
        <div className="hs-fade-in flex min-h-0 flex-1 flex-col">
          <ResponseBody ref={bodyRef} json={outcome.response_json} />
        </div>
      )}
```

- [ ] **Step 4: Run the gating tests to verify they pass**

Run: `pnpm vitest run src/features/response/ResponsePanel.test.tsx`
Expected: PASS — all existing tests plus the four new gating tests.

- [ ] **Step 5: Write the click→handle wiring test**

Create `src/features/response/ResponsePanel.collapse.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { forwardRef, useImperativeHandle } from "react";
import type { BodyViewHandle } from "@/features/bodyview/BodyView";

// Replace ResponseBody with a forwardRef stub that exposes a spy handle, so we
// can assert the header buttons drive the body without booting Monaco.
const handle = { collapseAll: vi.fn(), expandAll: vi.fn() };
vi.mock("./ResponseBody", () => ({
  ResponseBody: forwardRef<BodyViewHandle, { json: string }>(function ResponseBody(_props, ref) {
    useImperativeHandle(ref, () => handle, []);
    return <pre data-testid="body-stub" />;
  }),
}));
vi.mock("@/lib/use-prefs", () => ({ usePrefs: () => [{}] }));

import { ResponsePanel } from "./ResponsePanel";
import type { InvokeOutcomeIpc } from "@/ipc/bindings";

const ok: InvokeOutcomeIpc = {
  status_code: 0,
  status_message: "OK",
  response_json: `{"id":"echo"}`,
  trailing_metadata: {},
  elapsed_ms: 5,
};

beforeEach(() => {
  handle.collapseAll.mockClear();
  handle.expandAll.mockClear();
});

describe("ResponsePanel collapse/expand wiring", () => {
  it("Collapse all calls the body handle", () => {
    render(<ResponsePanel state="success" outcome={ok} />);
    fireEvent.click(screen.getByRole("button", { name: "collapse all" }));
    expect(handle.collapseAll).toHaveBeenCalledTimes(1);
    expect(handle.expandAll).not.toHaveBeenCalled();
  });

  it("Expand all calls the body handle", () => {
    render(<ResponsePanel state="success" outcome={ok} />);
    fireEvent.click(screen.getByRole("button", { name: "expand all" }));
    expect(handle.expandAll).toHaveBeenCalledTimes(1);
    expect(handle.collapseAll).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 6: Run the wiring test to verify it passes**

Run: `pnpm vitest run src/features/response/ResponsePanel.collapse.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 7: Run the full suite + typecheck + build**

Run: `pnpm vitest run`
Expected: PASS — all suites green (new tests included).

Run: `pnpm exec tsc --noEmit`
Expected: no errors.

Run: `pnpm build`
Expected: vite build succeeds.

- [ ] **Step 8: Commit**

```bash
git add src/features/response/ResponsePanel.tsx \
        src/features/response/ResponsePanel.test.tsx \
        src/features/response/ResponsePanel.collapse.test.tsx
git commit -m "feat(response): Collapse all / Expand all buttons on the Body tab"
```

---

## Final verification (pre-merge gate)

- [ ] `pnpm vitest run` — all green, new tests included.
- [ ] `pnpm exec tsc --noEmit` — clean.
- [ ] `pnpm build` — vite build succeeds.
- [ ] Backend untouched ⇒ no `cargo` run needed; `src/ipc/bindings.ts` unchanged (no IPC drift).
- [ ] **Live pass in WebView2 (`pnpm tauri:dev`)** — not scriptable; verify by hand:
  - Big response → minimap (color blocks) appears on the right; click/drag jumps. Small response → no strip. Resize the pane tall → strip disappears when everything fits.
  - Vertical scrollbar is visibly wider and easy to grab; clicking the trough pages by a screenful.
  - Collapse all folds the whole body; Expand all restores it. Buttons are hidden on Trailers/Headers/Contract, on errors, and on the idle empty state. A new Send resets folds (keyed remount).

## Notes

- **Request editor unchanged** except the shared scrollbar tweak — no minimap (`BODY_EDIT_OPTIONS` keeps `minimap.enabled: false` from `EDITOR_OPTIONS`), no fold buttons.
- **No persistence** of fold state — a response is ephemeral; folds reset on each new response by design.
- **>50MB raw path:** `renderResponse` disables folding and renders raw text (`elide.ts` `BODY_MAX_BYTES`). There `response_json` still renders via the success-body branch, but the buttons fold whatever Monaco regions exist (harmless) and the minimap + scrollbar still help. No extra guard (YAGNI).
- **No loop in the size-gate:** the minimap is a horizontal-right overlay — toggling it changes width, not the height the predicate compares — and the `minimapOn` guard makes redundant `updateOptions` calls no-ops regardless.
