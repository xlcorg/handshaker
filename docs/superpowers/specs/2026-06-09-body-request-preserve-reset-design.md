# Request body — preserve edits + Reset-to-template (Group A) — design

**Date:** 2026-06-09
**Status:** approved — plan written (`docs/superpowers/plans/2026-06-09-body-request-preserve-reset.md`)
**Branch:** `claude/musing-blackburn-edc9a0`

## Scope

The user listed four request-body problems. They split into two groups; this spec
covers **Group A only** (the small, frontend-only pair). Group B gets its own
spec/plan afterward.

- **Group A (this spec):** #1 body resets after a method change · #2 no way to force
  a reset back to the template.
- **Group B (deferred, separate spec):** #3 can't view the method's contract · #4 no
  body autocompletion. Both need the backend to expose the proto message schema.

## Problem

1. **Resets on method change.** `applyMethodSelection`
   ([actions.ts:44](../../../src/features/workflow/actions.ts)) **unconditionally**
   overwrites `requestJson` with a freshly-built skeleton every time a method is
   picked. Any hand-edited body is destroyed — even when re-selecting the same
   method.
2. **No force-reset.** Skeleton generation (`buildRequestSkeletonSafe` →
   `grpc_build_request_skeleton`) is reachable only from `applyMethodSelection`.
   Once you've edited the body there is no way to regenerate the template on demand.

## Decisions (locked during brainstorming)

- **On method change with an *edited* body → preserve it.** A *pristine* body
  (empty / `{}` / structurally equal to the current method's skeleton) is still
  auto-filled with the new method's skeleton. Edited bodies are kept verbatim.
- **Manual "Reset to template" button** regenerates the skeleton on demand.
- **No confirm dialog / no undo toast.** Reset just overwrites; recovery is native
  **Ctrl+Z** in Monaco (verified below).
- **Pristine detection is stateless** — rebuild the (pre-switch) method's skeleton
  and structurally compare. No new field on `Step`, no component-level ref.

## Why Ctrl+Z reverts a reset (verified)

Reset and auto-fill both flow as `onPatch({ requestJson })` → store → the `value`
prop of `BodyView` ([BodyView.tsx:34](../../../src/features/bodyview/BodyView.tsx)).
For an **editable** editor (the request body; `mode === "request"`, not read-only),
`@monaco-editor/react` v4.7 syncs a changed `value` via
`editor.executeEdits('', […])` + `editor.pushUndoStop()` — an **undoable** Monaco
operation — so Ctrl+Z reverts it. (`model.setValue`, which clears the undo stack, is
used by the wrapper only for read-only editors, i.e. the response pane — irrelevant
here.) The request editor uses a constant `key="request"`, so a value change does
**not** remount the editor.

Sources (primary + corroborating):
- `@monaco-editor/react` `Editor.tsx` —
  <https://github.com/suren-atoyan/monaco-react/blob/master/src/Editor/Editor.tsx>
- README (controlled mode preserves undo history) —
  <https://github.com/suren-atoyan/monaco-react>

No imperative editor handle is needed; a plain state-driven overwrite is enough.

## Design

### 1. `isPristineBody(body, skeleton)` — new pure helper in `actions.ts`

```
isPristineBody(body, skeleton):
  body.trim() ∈ {"", "{}"}                    → true   // empty / no method yet
  JSON.parse(body) deep-equals JSON.parse(skeleton)
                                              → true   // == skeleton, whitespace-agnostic
  body does not parse as JSON                 → false  // mid-edit; preserve
  otherwise                                   → false
```

Deep-equal on parsed JSON so reformatting/whitespace does not count as an edit. If
`skeleton` itself fails to parse (should not happen — backend emits valid JSON or the
`"{}"` fallback), fall back to a trimmed raw-string compare. Pure and directly unit-testable.

### 2. `applyMethodSelection` — conditional body replacement

The handler gains the current body + service/method (the call site
[CallPanel.tsx:92](../../../src/features/workflow/CallPanel.tsx) has them all on
`step`). New shape:

```ts
applyMethodSelection(
  patch,
  target,                                   // { address, tls }
  current: { requestJson: string; service: string; method: string },
  m: { service: string; method: string },
)
```

```
const oldSkeleton = await buildRequestSkeletonSafe(target, current.service, current.method)
const pristine    = isPristineBody(current.requestJson, oldSkeleton)
patch({ service: m.service, method: m.method })          // reflect selection immediately
const newSkeleton = await buildRequestSkeletonSafe(target, m.service, m.method)
if (pristine) patch({ requestJson: newSkeleton })        // else the edited body is kept
```

- Cost: one extra `grpcBuildRequestSkeleton` (old method) per method switch. The
  backend reuses the cached descriptor pool, and `buildRequestSkeletonSafe` is
  best-effort (falls back to `"{}"`), so this never throws or blocks selection.
- A loaded saved request almost never matches a bare skeleton → its body is
  preserved. (Rare false-positive: a saved body identical to the bare skeleton is
  treated as pristine and replaced — acceptable.)
- First selection on a fresh draft: `current.method` is empty → `oldSkeleton` is the
  `"{}"` fallback and `current.requestJson` is `"{}"` → pristine → the skeleton fills.

### 3. "Reset to template" button — in the Request tab strip

In `RequestTabs` ([RequestTabs.tsx:23](../../../src/features/workflow/RequestTabs.tsx)),
add a right-aligned action in the `h-10` tab strip, rendered **only when
`tab === "request"`**:

- Ghost icon-button, `RotateCcw` (lucide) + tooltip "Reset body to template".
  English label to match the surrounding UI (tabs, MethodPicker).
- **Disabled when `step.method` is empty** — no method ⇒ no template.
- On click → build the skeleton for the *current* `step.service`/`step.method`, then
  `onPatch({ requestJson })`. No toast, no confirm (Ctrl+Z is the recovery path).

IPC orchestration lives in `CallPanel`/`actions` (a thin `onResetBody` passed down);
`RequestTabs` only renders the button and invokes the callback. `RequestTabs` gains
an optional `onResetTemplate?: () => void` and the `step.method`-derived disabled
state.

## Components touched

| File | Change |
|------|--------|
| `src/features/workflow/actions.ts` | add `isPristineBody`; rewrite `applyMethodSelection` to conditional replace; add `resetBodyToTemplate` (or inline the build in `CallPanel`) |
| `src/features/workflow/CallPanel.tsx` | pass current body/service/method to `applyMethodSelection`; provide `onResetBody` to `RequestTabs` |
| `src/features/workflow/RequestTabs.tsx` | Reset-to-template button on the Request tab; `onResetTemplate` prop + disabled-when-no-method |

No backend / IPC / model changes. No new dependencies (`RotateCcw` is in lucide-react).

## Testing

Unit (vitest):

- `isPristineBody`: empty `""`, `"{}"`, whitespace-only-different vs skeleton (pristine);
  user-edited field, extra key, different value (not pristine); invalid JSON (not pristine).
- `applyMethodSelection`:
  - pristine body (== old skeleton / `"{}"`) → patches `service`/`method`, then
    `requestJson` with the **new** skeleton.
  - edited body → patches `service`/`method`, **does not** patch `requestJson`.
  - rewrite the existing test ([actions.test.ts:415-423](../../../src/features/workflow/actions.test.ts))
    which asserts the old always-overwrite contract.
- `resetBodyToTemplate` (if added): builds skeleton for the current method and patches
  `requestJson`; empty method → `"{}"`.
- `RequestTabs`: Reset button visible only on the Request tab; click → `onResetTemplate`;
  disabled when `step.method` is empty.

Manual (Monaco undo can't be asserted in jsdom — live WebView2 pass):

- Edit body → switch method → body preserved; switch with a pristine body → new skeleton fills.
- Click Reset → body becomes the current method's skeleton; **Ctrl+Z** restores the pre-reset body.

## Out of scope

- Group B (#3 view contract, #4 autocompletion) — separate spec/plan.
- The pre-existing undo-stack "bleed" across drafts (one shared Monaco model) — not
  introduced here, not addressed.
- Confirm dialogs / undo toasts for reset (explicitly declined — Ctrl+Z is the recovery).
