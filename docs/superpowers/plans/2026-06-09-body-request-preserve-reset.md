# Request body — preserve edits + Reset-to-template (Group A) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the request body from being wiped when the method changes (preserve hand-edits; only auto-fill a *pristine* body), and add a manual "Reset to template" button.

**Architecture:** Frontend-only. A pure `isPristineBody(body, skeleton)` decides whether a body is still the unedited skeleton. `applyMethodSelection` rebuilds the *pre-switch* method's skeleton, compares, and replaces the body only when pristine. A new `resetBodyToTemplate` action + a ghost icon-button in the Request tab strip regenerate the skeleton on demand. Both paths flow through `onPatch({ requestJson })` → the `BodyView` `value` prop → `@monaco-editor/react`'s `executeEdits`, so **Ctrl+Z** reverts a reset natively.

**Tech Stack:** React 18 + TypeScript, Vitest + Testing Library, lucide-react, the project's `Button`/`Tooltip` UI primitives. No backend/IPC/model changes.

**Spec:** `docs/superpowers/specs/2026-06-09-body-request-preserve-reset-design.md`

---

## File Structure

| File | Responsibility |
|------|----------------|
| `src/features/workflow/actions.ts` | add `isPristineBody`; rewrite `applyMethodSelection` (conditional replace); add `resetBodyToTemplate` |
| `src/features/workflow/actions.test.ts` | unit tests for the three above |
| `src/features/workflow/CallPanel.tsx` | pass current body/service/method to `applyMethodSelection`; provide `onResetTemplate` to `RequestTabs` (draft only) |
| `src/features/workflow/RequestTabs.tsx` | render the Reset-to-template button on the Request tab; new `onResetTemplate?` prop |
| `src/features/workflow/RequestTabs.test.tsx` | tests for the Reset button (visibility / click / disabled) |

---

## Task 1: `isPristineBody` pure helper

A body is "pristine" (safe to overwrite on a method switch) when it is empty, `{}`, or
structurally equal to the given skeleton. Whitespace/formatting differences do not count
as edits; invalid JSON (a mid-edit body) counts as edited.

**Files:**
- Modify: `src/features/workflow/actions.ts`
- Test: `src/features/workflow/actions.test.ts`

- [ ] **Step 1: Write the failing tests**

Append this `describe` block to `src/features/workflow/actions.test.ts` (after the
existing blocks). Also add `isPristineBody` to the existing import on line 13:

```ts
import { buildRequestSkeletonSafe, applyMethodSelection, isPristineBody } from "./actions";
```

```ts
describe("isPristineBody", () => {
  const skel = '{"a":""}';

  it("treats empty / {} bodies as pristine", () => {
    expect(isPristineBody("", skel)).toBe(true);
    expect(isPristineBody("   ", skel)).toBe(true);
    expect(isPristineBody("{}", skel)).toBe(true);
  });

  it("ignores whitespace/formatting when comparing to the skeleton", () => {
    expect(isPristineBody('{\n  "a": ""\n}', skel)).toBe(true);
  });

  it("treats an edited body as not pristine", () => {
    expect(isPristineBody('{"a":"edited"}', skel)).toBe(false); // changed value
    expect(isPristineBody('{"a":"","b":1}', skel)).toBe(false); // extra key
  });

  it("treats invalid JSON (mid-edit) as not pristine", () => {
    expect(isPristineBody('{"a":', skel)).toBe(false);
  });

  it("falls back to a trimmed string compare when the skeleton is unparseable", () => {
    expect(isPristineBody("not json", "not json")).toBe(true);
    expect(isPristineBody("not json", "other")).toBe(false);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run src/features/workflow/actions.test.ts -t isPristineBody`
Expected: FAIL — `isPristineBody is not a function` / import error.

- [ ] **Step 3: Implement `isPristineBody`**

Add to `src/features/workflow/actions.ts` (near the top, after the imports / before
`resolveAddressSafe`):

```ts
/** Canonical JSON string (whitespace-normalized), or undefined if `s` is not JSON. */
function canonicalJson(s: string): string | undefined {
  try {
    return JSON.stringify(JSON.parse(s));
  } catch {
    return undefined;
  }
}

/** True when `body` is still the unedited skeleton (or empty), so a method switch may
 *  safely replace it. Whitespace/formatting differences are NOT edits; invalid JSON is. */
export function isPristineBody(body: string, skeleton: string): boolean {
  const trimmed = body.trim();
  if (trimmed === "" || trimmed === "{}") return true;
  const cb = canonicalJson(body);
  if (cb === undefined) return false; // mid-edit, invalid JSON → preserve
  const cs = canonicalJson(skeleton);
  if (cs === undefined) return trimmed === skeleton.trim();
  return cb === cs;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm vitest run src/features/workflow/actions.test.ts -t isPristineBody`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/features/workflow/actions.ts src/features/workflow/actions.test.ts
git commit -m "feat(workflow): isPristineBody helper for body preservation"
```

---

## Task 2: `applyMethodSelection` preserves an edited body

Rewrite the handler so it replaces the body only when pristine, and update its one call
site. The handler gains a `current` argument (the pre-switch body + service/method).

**Files:**
- Modify: `src/features/workflow/actions.ts:44-52` (the `applyMethodSelection` function)
- Modify: `src/features/workflow/CallPanel.tsx:92-94` (the call site)
- Test: `src/features/workflow/actions.test.ts` (rewrite the `applyMethodSelection` block at lines ~415-423)

- [ ] **Step 1: Rewrite the failing tests**

Replace the existing `describe("applyMethodSelection", …)` block in
`src/features/workflow/actions.test.ts` with:

```ts
describe("applyMethodSelection", () => {
  it("replaces a pristine body with the new method's skeleton", async () => {
    vi.mocked(ipc.grpcBuildRequestSkeleton)
      .mockResolvedValueOnce('{"a":""}')  // old method skeleton (for pristine check)
      .mockResolvedValueOnce('{"b":""}'); // new method skeleton
    const patch = vi.fn();
    await applyMethodSelection(
      patch,
      { address: "h:443", tls: true },
      { requestJson: "{}", service: "p.S", method: "Old" }, // pristine
      { service: "p.S", method: "New" },
    );
    expect(patch).toHaveBeenNthCalledWith(1, { service: "p.S", method: "New" });
    expect(patch).toHaveBeenNthCalledWith(2, { requestJson: '{"b":""}' });
  });

  it("replaces when the body equals the skeleton modulo whitespace", async () => {
    vi.mocked(ipc.grpcBuildRequestSkeleton)
      .mockResolvedValueOnce('{"a":""}')
      .mockResolvedValueOnce('{"b":""}');
    const patch = vi.fn();
    await applyMethodSelection(
      patch,
      { address: "h:443", tls: true },
      { requestJson: '{\n  "a": ""\n}', service: "p.S", method: "Old" }, // == old skeleton
      { service: "p.S", method: "New" },
    );
    expect(patch).toHaveBeenNthCalledWith(2, { requestJson: '{"b":""}' });
  });

  it("preserves an edited body (patches service/method only)", async () => {
    vi.mocked(ipc.grpcBuildRequestSkeleton).mockResolvedValueOnce('{"a":""}'); // old skeleton
    const patch = vi.fn();
    await applyMethodSelection(
      patch,
      { address: "h:443", tls: true },
      { requestJson: '{"a":"edited"}', service: "p.S", method: "Old" }, // edited
      { service: "p.S", method: "New" },
    );
    expect(patch).toHaveBeenCalledTimes(1);
    expect(patch).toHaveBeenCalledWith({ service: "p.S", method: "New" });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run src/features/workflow/actions.test.ts -t applyMethodSelection`
Expected: FAIL — current `applyMethodSelection` takes 3 args and always patches the skeleton, so the arg shape and the "preserves" assertion fail.

- [ ] **Step 3: Rewrite `applyMethodSelection`**

Replace lines 43-52 of `src/features/workflow/actions.ts` with:

```ts
/** MethodPicker handler for an editable draft. Patches service/method, then replaces the
 *  body with the new method's skeleton ONLY when the current body is still pristine
 *  (empty / `{}` / structurally equal to the pre-switch method's skeleton). An edited body
 *  is preserved verbatim — use Reset-to-template (`resetBodyToTemplate`) to regenerate. */
export async function applyMethodSelection(
  patch: (p: Partial<Step>) => void,
  target: CallTargetInit,
  current: { requestJson: string; service: string; method: string },
  m: { service: string; method: string },
): Promise<void> {
  const oldSkeleton = await buildRequestSkeletonSafe(target, current.service, current.method);
  const pristine = isPristineBody(current.requestJson, oldSkeleton);
  patch({ service: m.service, method: m.method });
  if (pristine) {
    const requestJson = await buildRequestSkeletonSafe(target, m.service, m.method);
    patch({ requestJson });
  }
}
```

- [ ] **Step 4: Update the call site in `CallPanel.tsx`**

Replace lines 92-94 of `src/features/workflow/CallPanel.tsx`:

```tsx
        onSelectMethod={(m) =>
          void applyMethodSelection(onPatch, { address: step.address, tls: step.tls }, m)
        }
```

with:

```tsx
        onSelectMethod={(m) =>
          void applyMethodSelection(
            onPatch,
            { address: step.address, tls: step.tls },
            { requestJson: step.requestJson, service: step.service, method: step.method },
            m,
          )
        }
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm vitest run src/features/workflow/actions.test.ts -t applyMethodSelection`
Expected: PASS (3 tests).

- [ ] **Step 6: Typecheck the call-site change**

Run: `pnpm tsc --noEmit`
Expected: no errors (the new 4-arg signature matches the updated call site).

- [ ] **Step 7: Commit**

```bash
git add src/features/workflow/actions.ts src/features/workflow/actions.test.ts src/features/workflow/CallPanel.tsx
git commit -m "feat(workflow): preserve edited request body on method change"
```

---

## Task 3: `resetBodyToTemplate` action

A thin action that rebuilds the current method's skeleton and patches the body. Backs the
Reset button (Task 4).

**Files:**
- Modify: `src/features/workflow/actions.ts`
- Test: `src/features/workflow/actions.test.ts`

- [ ] **Step 1: Write the failing test**

Add `resetBodyToTemplate` to the import on line 13:

```ts
import { buildRequestSkeletonSafe, applyMethodSelection, isPristineBody, resetBodyToTemplate } from "./actions";
```

Append this block to `src/features/workflow/actions.test.ts`:

```ts
describe("resetBodyToTemplate", () => {
  it("patches requestJson with a fresh skeleton for the current method", async () => {
    vi.mocked(ipc.grpcBuildRequestSkeleton).mockResolvedValue('{"a":""}');
    const patch = vi.fn();
    await resetBodyToTemplate(patch, { address: "h:443", tls: true }, "p.S", "M");
    expect(ipc.grpcBuildRequestSkeleton).toHaveBeenCalledWith(
      { address: "h:443", tls: true, skip_verify: false },
      "p.S",
      "M",
    );
    expect(patch).toHaveBeenCalledWith({ requestJson: '{"a":""}' });
  });

  it("falls back to {} when the skeleton build fails", async () => {
    vi.mocked(ipc.grpcBuildRequestSkeleton).mockRejectedValue(new Error("boom"));
    const patch = vi.fn();
    await resetBodyToTemplate(patch, { address: "h", tls: false }, "S", "M");
    expect(patch).toHaveBeenCalledWith({ requestJson: "{}" });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run src/features/workflow/actions.test.ts -t resetBodyToTemplate`
Expected: FAIL — `resetBodyToTemplate is not a function`.

- [ ] **Step 3: Implement `resetBodyToTemplate`**

Add to `src/features/workflow/actions.ts` (right after `applyMethodSelection`):

```ts
/** Force-regenerate the request body from the current method's skeleton (Reset-to-template).
 *  Never throws — `buildRequestSkeletonSafe` falls back to `"{}"`. The overwrite flows through
 *  the editor's controlled `value`, so Ctrl+Z reverts it. */
export async function resetBodyToTemplate(
  patch: (p: Partial<Step>) => void,
  target: CallTargetInit,
  service: string,
  method: string,
): Promise<void> {
  const requestJson = await buildRequestSkeletonSafe(target, service, method);
  patch({ requestJson });
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run src/features/workflow/actions.test.ts -t resetBodyToTemplate`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/features/workflow/actions.ts src/features/workflow/actions.test.ts
git commit -m "feat(workflow): resetBodyToTemplate action"
```

---

## Task 4: Reset-to-template button (RequestTabs + CallPanel wiring)

Add a ghost icon-button to the Request tab strip, shown only on the Request tab and
disabled when no method is selected. Wire `CallPanel` to back it with `resetBodyToTemplate`
(draft/editable only).

**Files:**
- Modify: `src/features/workflow/RequestTabs.tsx`
- Modify: `src/features/workflow/CallPanel.tsx`
- Test: `src/features/workflow/RequestTabs.test.tsx`

- [ ] **Step 1: Write the failing tests**

Append to `src/features/workflow/RequestTabs.test.tsx`. Add the import at the top
(after the existing imports):

```ts
import { TooltipProvider } from "@/components/ui/tooltip";
```

Then add these tests inside the existing `describe("RequestTabs", …)` block:

```tsx
  it("shows a Reset-to-template button on the Request tab and calls onResetTemplate", async () => {
    const user = userEvent.setup();
    const onResetTemplate = vi.fn();
    const p = { ...setup(), onResetTemplate };
    render(
      <TooltipProvider>
        <RequestTabs {...p} />
      </TooltipProvider>,
    );
    const btn = screen.getByRole("button", { name: /reset body to template/i });
    await user.click(btn);
    expect(onResetTemplate).toHaveBeenCalledTimes(1);
  });

  it("hides the Reset button when not on the Request tab", async () => {
    const user = userEvent.setup();
    const p = { ...setup(), onResetTemplate: vi.fn() };
    render(
      <TooltipProvider>
        <RequestTabs {...p} />
      </TooltipProvider>,
    );
    await user.click(screen.getByRole("tab", { name: /metadata/i }));
    expect(screen.queryByRole("button", { name: /reset body to template/i })).toBeNull();
  });

  it("disables Reset when no method is selected", () => {
    const baseStep = newStep({ address: "h", tls: false, service: "S", method: "", requestJson: "{}" });
    const p = {
      step: baseStep,
      serviceAuth: { kind: "none" as const },
      onBody: vi.fn(),
      onMetadata: vi.fn(),
      onResetTemplate: vi.fn(),
    };
    render(
      <TooltipProvider>
        <RequestTabs {...p} />
      </TooltipProvider>,
    );
    expect(screen.getByRole("button", { name: /reset body to template/i })).toBeDisabled();
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run src/features/workflow/RequestTabs.test.tsx -t "Reset"`
Expected: FAIL — no `onResetTemplate` prop / no button rendered.

- [ ] **Step 3: Add the button to `RequestTabs`**

In `src/features/workflow/RequestTabs.tsx`, add imports at the top:

```tsx
import { RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
```

Add `onResetTemplate` to `RequestTabsProps`:

```tsx
export interface RequestTabsProps {
  step: Step;
  serviceAuth: SavedAuthConfigIpc;
  onBody: (value: string) => void;
  onMetadata: (rows: MetadataRow[]) => void;
  /** Ctrl/Cmd+Enter inside the body editor → send. */
  onSubmit?: () => void;
  /** Reset the body to the current method's skeleton (draft only). Omit to hide the button. */
  onResetTemplate?: () => void;
}
```

Destructure it in the component signature:

```tsx
export function RequestTabs({ step, serviceAuth, onBody, onMetadata, onSubmit, onResetTemplate }: RequestTabsProps) {
```

Replace **only** the tab-strip header — the `<div className="h-10 …">…</div>` that wraps
`<UnderlineTabs … />` (lines 23-33). Do **not** touch the outer `<div className="flex h-full
flex-col">` (line 22). Replace with:

```tsx
      <div className="h-10 flex-none flex items-center border-b border-border px-3.5">
        <UnderlineTabs<Tab>
          value={tab}
          onChange={setTab}
          items={[
            { value: "request", label: "Request" },
            { value: "metadata", label: "Metadata" },
            { value: "auth", label: "Auth" },
          ]}
        />
        {tab === "request" && onResetTemplate ? (
          <Tooltip content="Reset body to template">
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={onResetTemplate}
              disabled={step.method.trim().length === 0}
              aria-label="Reset body to template"
              className="ml-auto text-muted-foreground hover:text-foreground"
            >
              <RotateCcw />
            </Button>
          </Tooltip>
        ) : null}
      </div>
```

- [ ] **Step 4: Wire `CallPanel` to provide `onResetTemplate`**

In `src/features/workflow/CallPanel.tsx`, add `resetBodyToTemplate` to the existing
import from `./actions` (the `import { … } from "./actions"` block at lines 8-16):

```tsx
  resetBodyToTemplate,
```

Add a handler next to `onBody`/`onMetadata` (after line 41):

```tsx
  const onResetBody = () =>
    void resetBodyToTemplate(onPatch, { address: step.address, tls: step.tls }, step.service, step.method);
```

Pass it to `RequestTabs` (gated on `editable` so frozen history steps don't show it),
updating the `<RequestTabs … />` props (around lines 116-122):

```tsx
          <RequestTabs
            step={step}
            serviceAuth={step.auth}
            onBody={onBody}
            onMetadata={onMetadata}
            onSubmit={() => sendShortcutRef.current()}
            onResetTemplate={editable ? onResetBody : undefined}
          />
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm vitest run src/features/workflow/RequestTabs.test.tsx`
Expected: PASS — the three new Reset tests plus all pre-existing RequestTabs tests.

- [ ] **Step 6: Commit**

```bash
git add src/features/workflow/RequestTabs.tsx src/features/workflow/CallPanel.tsx src/features/workflow/RequestTabs.test.tsx
git commit -m "feat(workflow): Reset-to-template button in the Request tab"
```

---

## Task 5: Full verification

**Files:** none (verification only).

- [ ] **Step 1: Lint**

Run: `pnpm lint`
Expected: no errors.

- [ ] **Step 2: Typecheck**

Run: `pnpm tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Full test suite**

Run: `pnpm vitest run`
Expected: all suites green (the prior ~614-test baseline plus the new tests).

- [ ] **Step 4: Build**

Run: `pnpm build`
Expected: build succeeds.

- [ ] **Step 5: Manual verification checklist (human `pnpm tauri dev`, WebView2)**

Monaco undo can't be asserted in jsdom — confirm by hand:

- Edit the body, switch to another method → the edited body is **preserved**.
- With a pristine body (just-selected method, untouched), switch method → the body
  becomes the **new** method's skeleton.
- Click **Reset to template** → the body becomes the current method's skeleton;
  press **Ctrl+Z** → the pre-reset body is restored.
- Reset button is **disabled** until a method is selected; it does not appear on the
  Metadata/Auth tabs.

- [ ] **Step 6: Commit (if any doc/status updates)**

Update the plan's status banner if you track completion here, then:

```bash
git add -A
git commit -m "chore(workflow): verify body preserve + reset (Group A)"
```

---

## Notes for the implementer

- **Don't change `BodyView`/Monaco wiring.** Reset and auto-fill are plain
  `onPatch({ requestJson })` calls; the editable editor's controlled `value` is applied
  via `executeEdits` + `pushUndoStop` by `@monaco-editor/react`, so Ctrl+Z works for free.
- **`buildRequestSkeletonSafe` never throws** (falls back to `"{}"`), so neither
  `applyMethodSelection` nor `resetBodyToTemplate` needs try/catch.
- **Gate the Reset button on `editable`** in `CallPanel` — this also keeps the existing
  non-editable `CallPanel` test (which renders without a `TooltipProvider`) from rendering
  a `Tooltip` and throwing.
- **Out of scope:** Group B (#3 contract view, #4 autocompletion); cross-draft undo "bleed"
  on the shared Monaco model; confirm dialogs / undo toasts for reset.
