# Zero Test Warnings Implementation Plan

> **🎉 DONE** — all 9 tasks implemented and reviewed. `pnpm test` is 167 files /
> 1213 tests green with zero console output, and the guard is proven still armed.
> Shipped beyond the original plan: the guard is installed by plain assignment rather
> than `vi.spyOn`, because a `vi.resetAllMocks()` in any test's `beforeEach` would
> otherwise strip the mock implementation and silently disarm it — output destroyed,
> test green. Found by the final whole-branch review and verified by experiment.
> Known limitation: the guard's reach equals test coverage. `SettingsDialog.tsx` has
> the same missing-`DialogTitle`/`DialogDescription` defect as `SaveRequestDialog` but
> no test file, so nothing turned red for it — follow-up work.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `pnpm test` emit zero console output, and make any future warning fail the suite.

**Architecture:** A console guard in `src/test/setup.ts` collects every `console.error` /
`console.warn` during a test and asserts the collection is empty in `afterEach`. It goes
in first, turning all 184 existing warnings into 12 failing test files; each following
task drives one cluster back to green. Every fix in this plan was empirically verified
before the plan was written — the root causes and diffs are measured, not guessed.

**Tech Stack:** vitest 3 + jsdom, @testing-library/react, React 18, Radix UI.

Spec: `docs/superpowers/specs/2026-07-20-zero-test-warnings-design.md`.

## Global Constraints

- Package manager is **pnpm**. Frontend tests: `pnpm test` (`vitest run`); single file:
  `pnpm vitest run <path>`. Typecheck: `pnpm lint` (`tsc -b`).
- **Never suppress output.** No message allowlists, no filtering by text, no
  `console.error = () => {}` in `setup.ts`. The only sanctioned opt-out is a local
  `vi.spyOn(console, "error").mockImplementation(() => {})` inside the one test that
  deliberately provokes output, restored in a `finally` — as
  `src/features/updater/updaterContext.test.tsx:30` already does.
- **Fix tests, not production code** — except Task 3, which fixes a genuine a11y defect.
- Every user-facing string lives in `src/lib/messages.ts` (`.claude/rules/ui-strings.md`).
- Commits: Conventional Commits with a scope, **no trailers**
  (`.claude/rules/commit-messages.md`).
- The settle idiom for async mount effects is `await act(async () => {})`, **not**
  `waitFor` — `waitFor`'s first predicate check can run before the pending microtask
  flushes, so it is not a reliable barrier. `findBy*` is fine where the test already
  asserts on post-effect content, since RTL routes it through the async-`act` wrapper.
- The branch is intentionally **red from Task 1 until Task 8**. That is the point of
  guard-first. It never reaches `main` in that state: work happens on a `claude/*`
  branch and is squashed before the fast-forward
  (`.claude/rules/squashing-feature-branches.md`).
- Work **one file at a time**. Do not run parallel agents against this worktree.

## Warning inventory (measured baseline)

184 warnings: 163 `act(...)` + 21 a11y. Per file:

| File | Count | Task |
| --- | --- | --- |
| `src/features/workflow/CallPanel.editable.test.tsx` | 107 | 2 |
| `src/features/catalog/SaveRequestDialog.test.tsx` (source: `SaveRequestDialog.tsx`) | 21 | 3 |
| `src/features/catalog/SidebarShell.test.tsx` | 21 | 4 |
| `src/features/shell/Titlebar.test.tsx` | 13 | 5 |
| `src/features/catalog/overview/SavedAuthEditor.test.tsx` | 6 | 6 |
| `src/features/vars/VarHighlightInput.test.tsx` | 6 | 7 |
| `src/features/workflow/CallPanel.layout.test.tsx` | 4 | 2 |
| `src/features/settings/ImportExportPane.test.tsx` | 2 | 8 |
| `src/features/settings/AboutPane.test.tsx` | 1 | 8 |
| `src/features/catalog/RequestRow.test.tsx` | 1 | 8 |
| `src/features/catalog/overview/CollectionOverview.test.tsx` | 1 | 6 |
| `src/features/workflow/MetadataEditor.test.tsx` | 1 | 7 |

### How to measure — read this before running any check

The counts above are the **pre-guard** baseline, measured with:

```bash
pnpm vitest run <path> 2>&1 | grep -cE "^Warning:"
```

**That command stops working the moment Task 1 lands.** The guard intercepts
`console.error`/`console.warn`, so the text never reaches stderr with a bare `Warning:`
prefix — it is re-emitted as `console.error: …` inside a test failure message. After Task
1 the grep returns `0` whether or not warnings are being produced, which would read as
false success.

From Task 2 onward the criterion is simply: **the test file passes.** The guard's
`afterEach` asserts `expect(output.join("\n\n")).toBe("")` — exact equality against all
captured console output for that test — so a green file is a stronger guarantee than any
line count. Where a step below still shows a `grep -cE "^Warning:"` command, treat a
passing suite as the real verdict and the grep as informational only.

---

## File Structure

- `src/test/setup.ts` — **modify.** Gains the console guard. Sole owner of the policy;
  no per-file guard code anywhere else.
- `src/features/catalog/SaveRequestDialog.tsx` — **modify.** Gains a `DialogDescription`.
- `src/lib/messages.ts` — **modify.** Gains that description's copy.
- Ten test files — **modify.** Each learns to settle its own async effects. No shared
  test helper module is introduced: the flush belongs in each file's existing `render`
  wrapper, and inventing a cross-file helper would couple unrelated suites.

---

### Task 1: The console guard

**Files:**
- Modify: `src/test/setup.ts` (append at end of file)

**Interfaces:**
- Consumes: nothing.
- Produces: a global `beforeEach`/`afterEach` pair. Every later task's "0 warnings"
  check is enforced by this. No exported symbols.

**Context you need:** No test in this repo calls `vi.restoreAllMocks()` or
`resetAllMocks()`, and `vitest.config.ts` sets neither `restoreMocks` nor `clearMocks`
— verified. So the guard must restore only its **own** spies; a blanket
`vi.restoreAllMocks()` in `afterEach` would clobber the per-test spies that
`splash.test.ts`, `GrpcIcon.test.tsx`, `useAutosaveDraft.test.ts`,
`CollectionTree.test.tsx`, `useDraftReflection.test.ts` and `use-busy-delay.test.ts`
rely on.

- [ ] **Step 1: Append the guard to `src/test/setup.ts`**

```ts
// Any console.error / console.warn a test produces fails that test. React's act(...)
// warnings and Radix's a11y warnings both arrive on these channels, so this turns "the
// suite is noisy" into "the suite is red" — a new warning can no longer hide among old
// ones.
//
// The assertion runs in afterEach rather than throwing from inside console.error: React
// logs during render, and an exception thrown from there is swallowed by an error
// boundary, burying the real failure under unrelated noise.
//
// A test that legitimately expects console output opts out the way
// src/features/updater/updaterContext.test.tsx does — a local
// vi.spyOn(console, "error").mockImplementation(() => {}) restored in a finally. vi.spyOn
// captures whatever is currently installed, so its mockRestore puts this guard's spy
// back rather than the raw console, and the opt-out composes.
const GUARDED_CHANNELS = ["error", "warn"] as const;

let capturedConsoleOutput: string[] = [];

beforeEach(() => {
  capturedConsoleOutput = [];
  for (const channel of GUARDED_CHANNELS) {
    vi.spyOn(console, channel).mockImplementation((...args: unknown[]) => {
      capturedConsoleOutput.push(`console.${channel}: ${args.map(String).join(" ")}`);
    });
  }
});

afterEach(() => {
  const output = capturedConsoleOutput;
  capturedConsoleOutput = [];
  // Restore only our own spies — a blanket restoreAllMocks() would clobber the
  // per-test spies several suites install.
  for (const channel of GUARDED_CHANNELS) {
    (console[channel] as unknown as { mockRestore?: () => void }).mockRestore?.();
  }
  expect(output.join("\n\n")).toBe("");
});
```

- [ ] **Step 2: Add the imports at the top of `src/test/setup.ts`**

The file currently starts with `import "@testing-library/jest-dom/vitest";` and uses no
vitest globals. Add below that line:

```ts
import { afterEach, beforeEach, expect, vi } from "vitest";
```

- [ ] **Step 3: Verify the guard actually catches a warning**

A guard that silently passes is worthless. Prove it fires before trusting it. This needs
a real test file — `setup.ts` is not collected as a suite, so `describe`/`it` placed
there would never run.

Create a throwaway `src/test/guard-selfcheck.test.ts`:

```ts
import { describe, it, expect } from "vitest";

describe("console guard self-check", () => {
  it("fails the test when something writes to console.warn", () => {
    console.warn("boom");
    expect(true).toBe(true); // the guard, not this, must fail the test
  });

  it("fails the test when something writes to console.error", () => {
    console.error("kaboom");
    expect(true).toBe(true);
  });
});
```

Run: `pnpm vitest run src/test/guard-selfcheck.test.ts`

Expected: FAIL, 2 tests failed, the messages showing `console.warn: boom` and
`console.error: kaboom`. If they PASS, the guard is not wired up — fix it before going on.

Then delete the file:

```bash
rm src/test/guard-selfcheck.test.ts
```

- [ ] **Step 3b: Verify the opt-out still works**

Run: `pnpm vitest run src/features/updater/updaterContext.test.tsx`

Expected: PASS, 2 tests. This file deliberately provokes a React error and silences it
with its own `vi.spyOn(console, "error")` at line 30. If it now fails, the guard is
fighting the sanctioned opt-out and the spy-restore logic in `afterEach` is wrong.

- [ ] **Step 4: Confirm the expected failures, and only those**

Run: `pnpm test`

Expected: FAIL. Exactly these 12 files fail, and no others — cross-check against the
inventory table above:

```
CallPanel.editable, CallPanel.layout, SaveRequestDialog, SidebarShell, Titlebar,
SavedAuthEditor, CollectionOverview, VarHighlightInput, MetadataEditor,
ImportExportPane, AboutPane, RequestRow
```

If any **other** file fails, stop and report it — it is a warning the baseline survey
missed, and it needs its own task rather than being folded into an existing one.

- [ ] **Step 5: Commit**

```bash
git add src/test/setup.ts
git commit -m "test(setup): fail any test that writes to console

The suite emitted 184 warnings while passing, so a new one was
indistinguishable from the existing noise. Collect console.error/warn per
test and assert it is empty. The next commits drive the 12 now-failing
files back to green."
```

---

### Task 2: CallPanel — the async auth effect and its Radix cascade

**Files:**
- Modify: `src/features/workflow/CallPanel.editable.test.tsx` (107 warnings)
- Modify: `src/features/workflow/CallPanel.layout.test.tsx` (4 warnings)

**Interfaces:**
- Consumes: the guard from Task 1.
- Produces: nothing other tasks depend on. The `renderPanel` / `renderCallPanel` helpers
  are file-local by design.

**Root cause (measured, do not re-derive):** `src/features/workflow/useEffectiveAuth.ts:26-30`
runs `authEffective(...).then(resolved => setAuth(resolved))` inside `useEffect`;
`CallPanel.tsx:89-93` mounts it. The mocked `authEffective` resolves on a microtask after
the test's synchronous assertions, so `setAuth` lands outside `act`. The 74 `Tooltip` and
18 `UnderlineTabs` warnings are a **downstream cascade** of that single update — the
out-of-`act` re-render commits the whole subtree and Radix's `compose-refs` callback refs
call `dispatchSetState` during the commit. There are ~10 Tooltip fibers per editable
panel, hence ~10 warnings per affected test. Do not chase them individually.

- [ ] **Step 1: Run the failing tests to see the baseline**

Run: `pnpm vitest run src/features/workflow/CallPanel.editable.test.tsx 2>&1 | grep -cE "^Warning:"`
Expected: `107`

Run: `pnpm vitest run src/features/workflow/CallPanel.layout.test.tsx 2>&1 | grep -cE "^Warning:"`
Expected: `4`

- [ ] **Step 2: Add the flushing render helper to `CallPanel.layout.test.tsx`**

The file already has a `renderCallPanel` wrapper. Make it async:

```diff
-import { render } from "@testing-library/react";
+import { act, render } from "@testing-library/react";
@@
-function renderCallPanel(ui: React.ReactElement) {
-  return render(<TooltipProvider>{ui}</TooltipProvider>);
+/** Renders and flushes the mount-time async effects (useEffectiveAuth's
+ *  `auth_effective` fetch) inside act, so their setState doesn't land — and
+ *  re-render the tree — after the test's synchronous assertions. */
+async function renderCallPanel(ui: React.ReactElement) {
+  const result = render(<TooltipProvider>{ui}</TooltipProvider>);
+  await act(async () => {});
+  return result;
 }
```

Then in all 4 `it(...)` callbacks: change `() => {` to `async () => {`, and
`const { container } = renderCallPanel(` to `const { container } = await renderCallPanel(`.

- [ ] **Step 3: Verify `CallPanel.layout.test.tsx` is clean**

Run: `pnpm vitest run src/features/workflow/CallPanel.layout.test.tsx`
Expected: PASS, 4 tests.

Run: `pnpm vitest run src/features/workflow/CallPanel.layout.test.tsx 2>&1 | grep -cE "^Warning:"`
Expected: `0`

- [ ] **Step 4: Add the equivalent helper to `CallPanel.editable.test.tsx`**

This file has no wrapper yet — it inlines `<TooltipProvider>` at 13 render sites. Add
after the `const draft = newStep({...})` line:

```diff
-import { render, screen, fireEvent, waitFor } from "@testing-library/react";
+import { act, render, screen, fireEvent, waitFor } from "@testing-library/react";
@@ const draft = newStep({ address: "h:443", tls: true, service: "p.v1.S", method: "GetX" });
+
+/** Renders inside the tooltip provider and flushes the mount-time async effects
+ *  (useEffectiveAuth's `auth_effective`, useMessageSchema's fetches) inside act,
+ *  so their setState — and the whole-tree re-render it triggers — can't land
+ *  after the test's synchronous assertions. */
+async function renderPanel(ui: React.ReactElement) {
+  const result = render(<TooltipProvider>{ui}</TooltipProvider>);
+  await act(async () => {});
+  return result;
+}
```

Then collapse each of the 13 render sites and make the 9 synchronous `it` callbacks
async. Example of the transformation:

```diff
-  it("toggles TLS through onPatch from the draft header", () => {
+  it("toggles TLS through onPatch from the draft header", async () => {
     const onPatch = vi.fn();
-    render(
-      <TooltipProvider>
-        <CallPanel step={draft} onPatch={onPatch} editable />
-      </TooltipProvider>
-    );
+    await renderPanel(<CallPanel step={draft} onPatch={onPatch} editable />);
```

- [ ] **Step 5: Check the count — expect 28 remaining, not 0**

Run: `pnpm vitest run src/features/workflow/CallPanel.editable.test.tsx 2>&1 | grep -cE "^Warning:"`
Expected: `28`

This is the measured intermediate value. If you see `0` here, something else changed and
Step 6 may be unnecessary — verify before adding it. If you see `107`, the helper is not
being used at every site.

- [ ] **Step 6: Settle the send pipeline in the two keyboard-send tests**

The residual 28 come from the `Ctrl+Enter` / `Ctrl+R` tests, which start the async
`useSend` pipeline (`grpcSend` mock → patches + `workflowStore` snapshot) and then assert
synchronously. Add a settle at the end of each:

```diff
   it("Ctrl+Enter sends the editable draft (sets status: sending)", async () => {
     ...
     expect(onPatch).toHaveBeenCalledWith(expect.objectContaining({ status: "sending" }));
+    // The send itself is async — let it settle inside act.
+    await act(async () => {});
   });
```

```diff
   it("Ctrl+R also sends the editable draft (physical-key, layout-independent)", async () => {
     ...
     expect(onPatch).toHaveBeenCalledWith(expect.objectContaining({ status: "sending" }));
+    // The send itself is async — let it settle inside act.
+    await act(async () => {});
   });
```

- [ ] **Step 7: Verify both files are clean**

Run: `pnpm vitest run src/features/workflow/CallPanel.editable.test.tsx`
Expected: PASS, 13 tests.

Run: `pnpm vitest run src/features/workflow/CallPanel.editable.test.tsx 2>&1 | grep -cE "^Warning:"`
Expected: `0`

Run: `pnpm lint`
Expected: exit 0, no output.

- [ ] **Step 8: Commit**

```bash
git add src/features/workflow/CallPanel.editable.test.tsx src/features/workflow/CallPanel.layout.test.tsx
git commit -m "test(workflow): settle CallPanel's async auth effect inside act

useEffectiveAuth resolves auth_effective on a microtask; asserting
synchronously let the setState re-render the whole tree outside act, and
Radix's compose-refs then fired ~10 Tooltip updates per test. Flush the
mount effects in a render helper. 111 warnings to 0."
```

---

### Task 3: SaveRequestDialog — the missing dialog description

**Files:**
- Modify: `src/features/catalog/SaveRequestDialog.tsx` (around lines 212-214)
- Modify: `src/lib/messages.ts` (the `saveDialog` block)
- Test: `src/features/catalog/SaveRequestDialog.test.tsx` (21 warnings; no edit needed)

**Interfaces:**
- Consumes: the guard from Task 1.
- Produces: `messages.catalog.saveDialog.description(originBound: boolean) => string`.

**Root cause:** `SaveRequestDialog.tsx:212-214` renders `DialogHeader` containing only a
`DialogTitle`. Radix's `Dialog.Content` warns because `aria-describedby` has no target,
so screen-reader users get no description. This is a real product defect, not a test
artifact — 1 warning per test, 21 tests.

**Design decisions, already made — implement these, don't re-litigate:**
- **Per-mode copy.** `originBound` hides the entire collection picker
  (`!originBound && (…)` at line 228); the only remaining control is Name. A single
  description mentioning choosing a collection would be false in that mode. So the
  message is a function of the mode, which is also the pattern `ui-strings.md` prescribes.
- **`sr-only`.** Matches the neighbouring `DialogDescription` users,
  `CommandPalette.tsx:204` and `EnvEditorDialog.tsx:149`. It closes the a11y gap without
  changing the visual header. (`ConfirmDeleteDialog` / `DiscardDraftDialog` show theirs
  visibly, but those are prose-first `AlertDialog` confirmations — a different shape.)
- `originBound === true` rather than `originBound`, because the prop is
  `boolean | undefined`.

- [ ] **Step 1: See the failure**

Run: `pnpm vitest run src/features/catalog/SaveRequestDialog.test.tsx 2>&1 | grep -cE "^Warning:"`
Expected: `21`

- [ ] **Step 2: Add the copy to `src/lib/messages.ts`**

In the existing `saveDialog` block, above `recommendationTitle`:

```diff
     saveDialog: {
+      /** Screen-reader description of the dialog; the two modes offer different controls. */
+      description: (originBound: boolean) =>
+        originBound
+          ? "Rename this request and update the copy already saved in its collection."
+          : "Name the request and choose the collection or folder to save it in.",
       recommendationTitle: "Recommended location",
```

- [ ] **Step 3: Render the description in `SaveRequestDialog.tsx`**

```diff
 import {
   Dialog,
   DialogContent,
+  DialogDescription,
   DialogFooter,
@@
           <DialogTitle>{originBound ? "Update request" : "Save request"}</DialogTitle>
+          <DialogDescription className="sr-only">
+            {messages.catalog.saveDialog.description(originBound === true)}
+          </DialogDescription>
         </DialogHeader>
```

- [ ] **Step 4: Verify**

Run: `pnpm vitest run src/features/catalog/SaveRequestDialog.test.tsx`
Expected: PASS, 21 tests.

Run: `pnpm vitest run src/features/catalog/SaveRequestDialog.test.tsx 2>&1 | grep -cE "^Warning:"`
Expected: `0`

Run: `pnpm lint`
Expected: exit 0, no output.

- [ ] **Step 5: Commit**

```bash
git add src/features/catalog/SaveRequestDialog.tsx src/lib/messages.ts
git commit -m "fix(a11y): describe the save-request dialog for screen readers

DialogContent had no DialogDescription, so aria-describedby pointed at
nothing and Radix warned once per test. The copy differs per mode: the
originBound dialog hides the collection picker entirely."
```

---

### Task 4: SidebarShell — the leaking mock implementation

**Files:**
- Modify: `src/features/catalog/SidebarShell.test.tsx` (21 warnings), the `beforeEach` at line ~58

**Interfaces:**
- Consumes: the guard from Task 1.
- Produces: nothing.

**Root cause:** `vi.clearAllMocks()` clears calls but **not** implementations.
`SidebarShell.test.tsx:122` ("restores the persisted sort key on mount") sets
`vi.mocked(loadUiState).mockResolvedValue({ sort_key: "recent", ... })`, and that
implementation leaks into every later test. The mount effect at `SidebarShell.tsx:54-58`
(`void loadUiState().then(s => { if (s.sort_key) setSortKey(...) })`) then really does
call `setSortKey` after those synchronous tests have ended. Exactly the 7 tests after
line 122 warn; each cascades 2 `ScrollArea` warnings (the re-render changes `visible` at
`SidebarShell.tsx:66`, remounting `CollectionTree` children inside the same non-`act`
commit) — 7 + 14 = 21. Tests *before* line 122 never warned. The no-op `ResizeObserver`
stub is not implicated.

- [ ] **Step 1: See the failure**

Run: `pnpm vitest run src/features/catalog/SidebarShell.test.tsx 2>&1 | grep -cE "^Warning:"`
Expected: `21`

- [ ] **Step 2: Re-assert the mock default in `beforeEach`**

`loadUiState` is already imported at line 35.

```diff
 beforeEach(() => {
   localStorage.clear();
   vi.clearAllMocks();
+  // clearAllMocks keeps implementations, so a per-test mockResolvedValue would leak
+  // into later tests and make the mount effect setState after a sync test ended.
+  vi.mocked(loadUiState).mockResolvedValue({ sort_key: null, active_request: null });
   tree.current = makeTreeHook();
 });
```

- [ ] **Step 3: Verify**

Run: `pnpm vitest run src/features/catalog/SidebarShell.test.tsx`
Expected: PASS, 16 tests.

Run: `pnpm vitest run src/features/catalog/SidebarShell.test.tsx 2>&1 | grep -cE "^Warning:"`
Expected: `0`

- [ ] **Step 4: Commit**

```bash
git add src/features/catalog/SidebarShell.test.tsx
git commit -m "test(catalog): stop the loadUiState mock leaking between SidebarShell tests

clearAllMocks resets calls but not implementations, so one test's
sort_key: 'recent' made the mount effect setSortKey after every later sync
test ended — 7 warnings plus 14 cascaded from ScrollArea."
```

---

### Task 5: Titlebar — the env-list mount effect

**Files:**
- Modify: `src/features/shell/Titlebar.test.tsx` (13 warnings)

**Interfaces:**
- Consumes: the guard from Task 1.
- Produces: nothing.

**Root cause:** `Titlebar` renders `WorkflowEnvControl`, whose `refreshEnvs`
(`WorkflowEnvControl.tsx:33-39`) does `setEnvs(await envList())` and is called from a
mount effect (`:62-64`). Every `render(<Titlebar/>)` therefore schedules a `setEnvs` on a
microtask that lands after a synchronous test body ends.

- [ ] **Step 1: See the failure**

Run: `pnpm vitest run src/features/shell/Titlebar.test.tsx 2>&1 | grep -cE "^Warning:"`
Expected: `13`

- [ ] **Step 2: Flush inside the file's existing `render` helper**

The file already wraps RTL's render to supply a `TooltipProvider`. Put the flush there
rather than at all 17 call sites:

```diff
-import { render as rtlRender, screen } from "@testing-library/react";
+import { render as rtlRender, screen, act } from "@testing-library/react";
@@
 // Titlebar uses <Tooltip>, which (like main.tsx) requires a TooltipProvider.
-function render(ui: React.ReactElement) {
-  return rtlRender(<TooltipProvider>{ui}</TooltipProvider>);
+// WorkflowEnvControl also fetches envs in a mount effect (`setEnvs(await envList())`),
+// so the helper flushes that microtask inside act() — otherwise the state update
+// lands after the test's sync assertions, outside act().
+async function render(ui: React.ReactElement) {
+  const result = rtlRender(<TooltipProvider>{ui}</TooltipProvider>);
+  await act(async () => {});
+  return result;
 }
```

Then mechanically: all 17 `render(<Titlebar …/>)` become `await render(<Titlebar …/>)`,
and the 11 `it("…", () => {` callbacks that are not already async become
`it("…", async () => {`.

The single `rerender(...)` call stays synchronous — the effect does not re-fire, because
`refreshEnvs` is a stable `useCallback`.

- [ ] **Step 3: Verify**

Run: `pnpm vitest run src/features/shell/Titlebar.test.tsx`
Expected: PASS, 17 tests.

Run: `pnpm vitest run src/features/shell/Titlebar.test.tsx 2>&1 | grep -cE "^Warning:"`
Expected: `0`

- [ ] **Step 4: Commit**

```bash
git add src/features/shell/Titlebar.test.tsx
git commit -m "test(shell): flush WorkflowEnvControl's env fetch inside act

Titlebar mounts WorkflowEnvControl, which does setEnvs(await envList()) on
mount; the render helper now drains that microtask so the update can't land
after a sync test body."
```

---

### Task 6: SavedAuthEditor and CollectionOverview — the env-names mount effect

**Files:**
- Modify: `src/features/catalog/overview/SavedAuthEditor.test.tsx` (6 warnings)
- Modify: `src/features/catalog/overview/CollectionOverview.test.tsx` (1 warning)

**Interfaces:**
- Consumes: the guard from Task 1.
- Produces: nothing.

**Root cause:** `SavedAuthEditor.tsx:54-56` runs
`void ipc.envList().then((envs) => setEnvNames(envs.map(e => e.name)))` in a mount
effect. `CollectionOverview.test.tsx` mounts the same component when the Authorization
tab is clicked.

- [ ] **Step 1: See the failures**

Run: `pnpm vitest run src/features/catalog/overview/SavedAuthEditor.test.tsx 2>&1 | grep -cE "^Warning:"`
Expected: `6`

Run: `pnpm vitest run src/features/catalog/overview/CollectionOverview.test.tsx 2>&1 | grep -cE "^Warning:"`
Expected: `1`

- [ ] **Step 2: Add a flushing helper to `SavedAuthEditor.test.tsx`**

Insert after the `const oauth2: SavedAuthConfigIpc = {...}` fixture, before
`describe("SavedAuthEditor", …)`:

```diff
-import { render, screen, fireEvent, waitFor } from "@testing-library/react";
+import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
@@
+/**
+ * SavedAuthEditor fetches env names in a mount effect (`ipc.envList().then(setEnvNames)`),
+ * so a bare `render` leaves a state update to land after the test's sync assertions —
+ * outside act(). Flush that microtask inside act() before asserting.
+ */
+async function renderEditor(ui: Parameters<typeof render>[0]) {
+  const result = render(ui);
+  await act(async () => {});
+  return result;
+}
+
 describe("SavedAuthEditor", () => {
```

Then all 8 `render(<SavedAuthEditor …/>)` become `await renderEditor(<SavedAuthEditor …/>)`,
and the 6 synchronous `it` callbacks become `async`. **Every `it` containing an `await`
must be `async`** — a bare `await` inside a non-async callback is a syntax error, and an
earlier attempt at this fix tripped over exactly that.

- [ ] **Step 3: Settle the one CollectionOverview test**

`act` is already imported in that file.

```diff
-  it("the Authorization tab persists a chosen auth via collectionSetNodeAuth", () => {
+  it("the Authorization tab persists a chosen auth via collectionSetNodeAuth", async () => {
     r(<CollectionOverview {...props()} />);
     fireEvent.click(screen.getByText("Authorization"));
+    // SavedAuthEditor mounts here and fetches env names in an effect; let that
+    // microtask settle inside act() before asserting.
+    await act(async () => {});
     fireEvent.click(screen.getByText("Bearer"));
```

- [ ] **Step 4: Verify**

Run: `pnpm vitest run src/features/catalog/overview/SavedAuthEditor.test.tsx`
Expected: PASS, 8 tests.

Run: `pnpm vitest run src/features/catalog/overview/CollectionOverview.test.tsx`
Expected: PASS, 10 tests.

Both `grep -cE "^Warning:"` counts: `0`.

Run: `pnpm lint`
Expected: exit 0, no output.

- [ ] **Step 5: Commit**

```bash
git add src/features/catalog/overview/SavedAuthEditor.test.tsx src/features/catalog/overview/CollectionOverview.test.tsx
git commit -m "test(catalog): settle SavedAuthEditor's env-name fetch inside act"
```

---

### Task 7: The bare `focus()` calls

**Files:**
- Modify: `src/features/vars/VarHighlightInput.test.tsx` (6 warnings), lines ~111 and ~128
- Modify: `src/features/workflow/MetadataEditor.test.tsx` (1 warning), line ~17

**Interfaces:**
- Consumes: the guard from Task 1.
- Produces: nothing.

**Root cause:** RTL wraps only `fireEvent` / `userEvent` in `act`. A bare `input.focus()`
fires React's `onFocus` on the `<input>`, which Radix Tooltip's anchor uses to open the
tooltip — a state update outside `act`. `VarHighlightInput.tsx:324-326` always wraps the
field in `<TooltipProvider><Tooltip>`, so every focused field hits this.
`MetadataEditor` renders `VarHighlightInput` for its value field and has the same helper.

Both sites in `VarHighlightInput.test.tsx` must be wrapped: line 111 (used by one test)
and line 128 inside `typeInto` (used by 5 autocomplete tests) — 6 warnings, 1 each.
Wrapping only one leaves the other's warnings behind.

- [ ] **Step 1: See the failures**

Run: `pnpm vitest run src/features/vars/VarHighlightInput.test.tsx 2>&1 | grep -cE "^Warning:"`
Expected: `6`

Run: `pnpm vitest run src/features/workflow/MetadataEditor.test.tsx 2>&1 | grep -cE "^Warning:"`
Expected: `1`

- [ ] **Step 2: Wrap both sites in `VarHighlightInput.test.tsx`**

```diff
-import { render, screen, waitFor, fireEvent } from "@testing-library/react";
+import { render, screen, waitFor, fireEvent, act } from "@testing-library/react";
@@ (line ~111, inside the "keeps the input focused" test)
-    input.focus();
+    act(() => input.focus()); // Radix Tooltip opens on focus — a React state update
@@ (line ~128, inside function typeInto)
-  input.focus();
+  act(() => input.focus()); // Radix Tooltip opens on focus — a React state update
```

- [ ] **Step 3: Wrap the one site in `MetadataEditor.test.tsx`**

```diff
-import { render, screen, fireEvent } from "@testing-library/react";
+import { render, screen, fireEvent, act } from "@testing-library/react";
@@ (line ~17, inside function typeInto)
-  input.focus();
+  act(() => input.focus()); // Radix Tooltip opens on focus — a React state update
```

- [ ] **Step 4: Verify**

Run: `pnpm vitest run src/features/vars/VarHighlightInput.test.tsx`
Expected: PASS, 14 tests. Warning count: `0`.

Run: `pnpm vitest run src/features/workflow/MetadataEditor.test.tsx`
Expected: PASS, 5 tests. Warning count: `0`.

- [ ] **Step 5: Commit**

```bash
git add src/features/vars/VarHighlightInput.test.tsx src/features/workflow/MetadataEditor.test.tsx
git commit -m "test(vars): wrap bare input.focus() in act

RTL only wraps fireEvent/userEvent, so a direct focus() ran React's
onFocus — and Radix Tooltip's open-on-focus state update — outside act."
```

---

### Task 8: The three remaining single-cause files

**Files:**
- Modify: `src/features/settings/ImportExportPane.test.tsx` (2 warnings)
- Modify: `src/features/settings/AboutPane.test.tsx` (1 warning)
- Modify: `src/features/catalog/RequestRow.test.tsx` (1 warning)

**Interfaces:**
- Consumes: the guard from Task 1.
- Produces: nothing.

Three unrelated causes, grouped only because each is a one-line fix.

- [ ] **Step 1: Fix `ImportExportPane.test.tsx` — the catalog tree's mount reload**

`useCatalogTree.ts:120` runs `void reload()` on mount; `reload` awaits
`ipc.collectionList()` and then calls `setTree` (`:97`) and `setLoading(false)` (`:115`)
— exactly 2 updates after teardown in a synchronous test.

```diff
-  it("renders Export and Import actions + the non-destructive note", () => {
+  it("renders Export and Import actions + the non-destructive note", async () => {
     render(…);
-    expect(screen.getByRole("button", { name: /^export$/i })).toBeInTheDocument();
+    // CatalogProvider's mount effect awaits ipc.collectionList() and then sets tree +
+    // loading; let those land inside the test rather than after teardown, outside act().
+    expect(await screen.findByRole("button", { name: /^export$/i })).toBeInTheDocument();
```

Run: `pnpm vitest run src/features/settings/ImportExportPane.test.tsx`
Expected: PASS, 1 test. Warning count: `0`.

- [ ] **Step 2: Fix `AboutPane.test.tsx` — the version fetch**

`AboutPane.tsx:11-13` runs `useEffect(() => { ipc.appVersion().then(setVersion) })`. The
second test is fully synchronous, so the mocked promise resolves after teardown. (The
first test already awaits `user.click`, which flushes it — leave that one alone.)

```diff
-  it("disables the button while a check is in flight", () => {
+  it("disables the button while a check is in flight", async () => {
     render(…);
+    // AboutPane's mount effect resolves ipc.appVersion() → setVersion; let it land inside
+    // the test, otherwise the state update fires after teardown, outside act().
+    await screen.findByText("1.2.3");
     expect(screen.getByRole("button", { name: /checking/i })).toBeDisabled();
```

Run: `pnpm vitest run src/features/settings/AboutPane.test.tsx`
Expected: PASS, 2 tests. Warning count: `0`.

- [ ] **Step 3: Fix `RequestRow.test.tsx` — the prefs broadcast**

Only the "renders the gRPC icon when a style pref is set" test warns. `setPref`
(`src/lib/use-prefs.ts:146`) calls `broadcast`, which does
`for (const fn of listeners) fn(next)` (`:125`), pushing a `setState` into the
still-mounted row's `usePrefs`. The first `setPref` (line ~71) runs before render and is
harmless; the reset in the `finally` (line ~79) runs after render.

```diff
-import { render, screen, fireEvent } from "@testing-library/react";
+import { render, screen, fireEvent, act } from "@testing-library/react";
@@
-      setPref("grpcIcon", "off"); // reset the module-level singleton for sibling tests
+      // Broadcasts to the mounted row's usePrefs subscriber ⇒ a React state update.
+      act(() => setPref("grpcIcon", "off")); // reset the module-level singleton for sibling tests
```

Run: `pnpm vitest run src/features/catalog/RequestRow.test.tsx`
Expected: PASS, 15 tests. Warning count: `0`.

- [ ] **Step 4: Commit**

```bash
git add src/features/settings/ImportExportPane.test.tsx src/features/settings/AboutPane.test.tsx src/features/catalog/RequestRow.test.tsx
git commit -m "test: settle the last three post-teardown state updates

Catalog tree reload, AboutPane's version fetch, and the prefs broadcast in
RequestRow each landed a setState after their sync test ended."
```

---

### Task 9: The gate

**Files:**
- Modify: `CLAUDE.md` ("Active work" section)

**Interfaces:**
- Consumes: everything above.
- Produces: nothing.

- [ ] **Step 1: Run the full frontend suite**

Run: `pnpm test`
Expected: `Test Files 167 passed (167)`, `Tests 1213 passed (1213)`.

- [ ] **Step 2: Prove zero warnings — and prove the guard is still armed**

A green suite only means "zero warnings" if the guard is actually running. A grep for
`^Warning:` proves nothing here (see "How to measure" above), and a guard accidentally
disabled would also produce a green suite. So verify both halves.

First, the suite itself:

```bash
pnpm test 2>&1 | grep -c "^stderr |"
```

Expected: `0`. Combined with Step 1's all-green result, this establishes that no test
produced console output and none leaked to stderr by another route.

Second, prove the guard still fails a dirty test. Recreate the throwaway self-check from
Task 1:

```ts
// src/test/guard-selfcheck.test.ts
import { describe, it, expect } from "vitest";

describe("console guard self-check", () => {
  it("still fails the test when something writes to console.warn", () => {
    console.warn("boom");
    expect(true).toBe(true);
  });
});
```

Run: `pnpm vitest run src/test/guard-selfcheck.test.ts`
Expected: FAIL, with `console.warn: boom` in the message.

Then delete it: `rm src/test/guard-selfcheck.test.ts`

If it PASSES, the guard has been disabled or broken somewhere in Tasks 2-8 and the whole
green suite is meaningless — stop and find out why.

- [ ] **Step 3: Run the rest of the gate**

Run: `pnpm lint`
Expected: exit 0, no output.

Run: `cargo test --workspace`
Expected: all tests pass. (Untouched by this work, but it is part of the gate.)

- [ ] **Step 4: Update the "Active work" pointer in `CLAUDE.md`**

Replace the "Latest merged" entry with a compact 4-line entry per
`.claude/rules/archiving-completed-work.md`: name, one-sentence gist, the `archive/` plan
path, and the memory link. The previous entry (body completion) is dropped.

- [ ] **Step 5: Archive the plan and spec**

Per `.claude/rules/archiving-completed-work.md`, set this plan's status banner to
`🎉 DONE` and `git mv` both documents:

```bash
git mv docs/superpowers/plans/2026-07-20-zero-test-warnings.md docs/superpowers/plans/archive/
git mv docs/superpowers/specs/2026-07-20-zero-test-warnings-design.md docs/superpowers/specs/archive/
git add CLAUDE.md
git commit -m "docs(archive): zero test warnings plan+spec"
```

- [ ] **Step 6: Squash and merge**

Per `.claude/rules/squashing-feature-branches.md`, squash the branch to one cohesive
commit (the archive commit may stay separate), rebase onto the current `main` tip, and
fast-forward merge.
