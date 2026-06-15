# Send button + response polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Status:** 🚧 in progress — not started. **Branch:** `claude/jolly-wright-9523f9`.
**Spec:** [../specs/2026-06-16-send-response-ui-polish-design.md](../specs/2026-06-16-send-response-ui-polish-design.md).
**Gate:** `pnpm vitest run` · `pnpm tsc -p tsconfig.json --noEmit` · `pnpm build` · `cargo check` (no backend change). Live WebView2 pass for motion + jitter; macOS deferred.

**Goal:** Remove the redundant word from the Send tooltip, stop the Send↔Cancel button twitch on sub-threshold responses, and add a gentle arrival fade to the response body plus an instant press acknowledgement on Send.

**Architecture:** One small shared hook `useBusyDelay(active, delayMs)` implements the "delay" half of the spin-delay anti-flicker pattern; it gates the Send→Cancel swap in both address bars and replaces ResponsePanel's inline 250 ms progress timer (one shared 250 ms constant ⇒ comet and button appear in lockstep). A `.hs-fade-in` CSS utility (120 ms, `--ease-out`) wraps the response-body result; the Send button gets an `active:scale` press affordance. Frontend-only — backend / IPC / `bindings.ts` untouched.

**Tech Stack:** React 18, TypeScript, Tailwind, shadcn `Button`, Vitest + Testing Library, Vite. Tauri 2 (WebView2 on Windows).

**Commit convention:** lowercase `type(scope): summary`; every commit message ends with the trailer:
`Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.

---

## File structure

- **Create** `src/lib/use-busy-delay.ts` — the delayed-busy hook (one responsibility: turn a boolean true only after it has held for `delayMs`). Mirrors the `src/lib/use-fullscreen.ts` / `use-prefs.ts` placement & kebab-case naming.
- **Create** `src/lib/use-busy-delay.test.ts` — unit test (fake timers).
- **Modify** `src/features/workflow/DraftAddressBar.tsx` — tooltip text; gate the swap; `min-w`; Send press affordance.
- **Modify** `src/features/workflow/DraftAddressBar.test.tsx` — update the "while sending" test for the gate.
- **Modify** `src/features/workflow/AddressBar.tsx` — gate the swap; `min-w`; Send press affordance.
- **Modify** `src/features/workflow/AddressBar.test.tsx` — update the "while sending" test for the gate.
- **Modify** `src/features/workflow/CallPanel.tsx` — `onSend` re-entrancy guard.
- **Modify** `src/features/workflow/CallPanel.editable.test.tsx` — add a re-entrancy test.
- **Modify** `src/features/response/ResponsePanel.tsx` — use the hook for progress; wrap body results with `.hs-fade-in`.
- **Modify** `src/styles/globals.css` — `.hs-fade-in` keyframes.

---

## Task 1: `useBusyDelay` hook

**Files:**
- Create: `src/lib/use-busy-delay.ts`
- Test: `src/lib/use-busy-delay.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/use-busy-delay.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useBusyDelay } from "./use-busy-delay";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("useBusyDelay", () => {
  it("stays false until the delay elapses, then turns true", () => {
    const { result } = renderHook(() => useBusyDelay(true, 250));
    expect(result.current).toBe(false);
    act(() => vi.advanceTimersByTime(249));
    expect(result.current).toBe(false);
    act(() => vi.advanceTimersByTime(1));
    expect(result.current).toBe(true);
  });

  it("never turns true for a sub-delay burst", () => {
    const { result, rerender } = renderHook(
      ({ a }: { a: boolean }) => useBusyDelay(a, 250),
      { initialProps: { a: true } },
    );
    act(() => vi.advanceTimersByTime(100));
    rerender({ a: false });
    act(() => vi.advanceTimersByTime(500));
    expect(result.current).toBe(false);
  });

  it("resets to false immediately when active goes false", () => {
    const { result, rerender } = renderHook(
      ({ a }: { a: boolean }) => useBusyDelay(a, 250),
      { initialProps: { a: true } },
    );
    act(() => vi.advanceTimersByTime(250));
    expect(result.current).toBe(true);
    rerender({ a: false });
    expect(result.current).toBe(false);
  });

  it("clears the timer on unmount", () => {
    const { unmount } = renderHook(() => useBusyDelay(true, 250));
    unmount();
    // No pending state update should fire after unmount.
    expect(() => act(() => vi.advanceTimersByTime(250))).not.toThrow();
  });
});
```

- [ ] **Step 2: Run the test, verify it fails**

Run: `pnpm vitest run src/lib/use-busy-delay.test.ts`
Expected: FAIL — `Failed to resolve import "./use-busy-delay"`.

- [ ] **Step 3: Write the hook**

```ts
// src/lib/use-busy-delay.ts
import { useEffect, useState } from "react";

/** Returns `true` only once `active` has stayed `true` continuously for `delayMs`,
 *  and flips back to `false` immediately when `active` goes false.
 *
 *  This is the "delay" half of the spin-delay anti-flicker pattern
 *  (https://github.com/smeijer/spin-delay): a burst shorter than `delayMs` never
 *  shows the busy state at all, so a fast in-flight call doesn't flash a Cancel /
 *  progress indicator. We intentionally omit spin-delay's `minDuration` — the
 *  callers here gate *actionable* affordances (a Cancel button); holding one past
 *  completion would offer a meaningless cancel. minDuration belongs to spinners. */
export function useBusyDelay(active: boolean, delayMs: number): boolean {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (!active) {
      setShown(false);
      return;
    }
    const t = setTimeout(() => setShown(true), delayMs);
    return () => clearTimeout(t);
  }, [active, delayMs]);
  return shown;
}
```

- [ ] **Step 4: Run the test, verify it passes**

Run: `pnpm vitest run src/lib/use-busy-delay.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/use-busy-delay.ts src/lib/use-busy-delay.test.ts
git commit -m "feat(ui): useBusyDelay — delayed busy flag (spin-delay 'delay' half)"
```

---

## Task 2: DraftAddressBar — tooltip text + gated swap + stable width + press

**Files:**
- Modify: `src/features/workflow/DraftAddressBar.tsx`
- Test: `src/features/workflow/DraftAddressBar.test.tsx`

- [ ] **Step 1: Update the "while sending" test for the gate**

Replace the existing test at `DraftAddressBar.test.tsx:72-78` ("shows Cancel (not Send) while sending …") with the gated version. Also add `act` to the testing-library import on line 3 (`import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";`).

```tsx
  it("keeps Send during the busy gate, then swaps to Cancel and calls onCancel", () => {
    vi.useFakeTimers();
    try {
      const p = props({ step: { ...base, status: "sending" } });
      r(<DraftAddressBar {...p} />);
      // Sub-250ms calls never flip to Cancel — the button doesn't twitch.
      expect(screen.getByRole("button", { name: /send/i })).toBeInTheDocument();
      act(() => vi.advanceTimersByTime(250));
      expect(screen.queryByRole("button", { name: /send/i })).toBeNull();
      fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
      expect(p.onCancel).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
```

- [ ] **Step 2: Run it, verify it fails**

Run: `pnpm vitest run src/features/workflow/DraftAddressBar.test.tsx -t "busy gate"`
Expected: FAIL — Cancel shows immediately (gate not implemented yet), so the first `getByRole(... /send/i)` assertion throws.

- [ ] **Step 3: Implement the gate, tooltip, width, and press in `DraftAddressBar.tsx`**

Add the hook import at the top (after the existing imports):

```tsx
import { useBusyDelay } from "@/lib/use-busy-delay";
```

Replace the `const sending = step.status === "sending";` line (currently line 40) with:

```tsx
  const sending = step.status === "sending";
  // Delay the Send→Cancel swap so a sub-250ms call never twitches the button.
  // Same 250ms as the response comet (ResponsePanel) ⇒ they appear in lockstep.
  const showCancel = useBusyDelay(sending, 250);
```

Replace the whole `{sending ? ( … ) : ( … )}` action-button block (currently lines 76-86) with:

```tsx
      {showCancel ? (
        <Button size="sm" variant="ghost" onClick={onCancel} className="min-w-[5rem] text-muted-foreground">
          Cancel
        </Button>
      ) : (
        <Tooltip content={<span><Kbd>Ctrl</Kbd> <Kbd>Enter</Kbd></span>}>
          <Button
            size="sm"
            onClick={onSend}
            disabled={step.method.trim().length === 0}
            className="min-w-[5rem] active:scale-[.97]"
          >
            ▶ Send
          </Button>
        </Tooltip>
      )}
```

Notes baked in by this edit: tooltip no longer contains the word "Send" (only the keys); `min-w-[5rem]` is on **both** buttons so the swap doesn't reflow neighbours; `active:scale-[.97]` rides the shadcn `Button`'s existing `transition-all` (~150 ms) for an instant press acknowledgement.

- [ ] **Step 4: Run the bar's tests, verify green**

Run: `pnpm vitest run src/features/workflow/DraftAddressBar.test.tsx`
Expected: PASS (all, including the disabled-Send and fires-Send tests — idle state shows `▶ Send`, gate stays false).

- [ ] **Step 5: Commit**

```bash
git add src/features/workflow/DraftAddressBar.tsx src/features/workflow/DraftAddressBar.test.tsx
git commit -m "fix(ui): gate draft Send→Cancel swap; tooltip shows only the hotkey; stable button width + press"
```

---

## Task 3: AddressBar (history re-send) — gated swap + stable width + press

**Files:**
- Modify: `src/features/workflow/AddressBar.tsx`
- Test: `src/features/workflow/AddressBar.test.tsx`

- [ ] **Step 1: Update the "while sending" test for the gate**

Replace the file body of `AddressBar.test.tsx` with (drops `userEvent` — it doesn't cooperate with fake timers — for `fireEvent` + `act`):

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { AddressBar } from "./AddressBar";
import { newStep } from "./model";

const base = newStep({ address: "h:443", tls: true, service: "S", method: "M" });

describe("AddressBar cancel", () => {
  it("shows Send (not Cancel) when idle", () => {
    render(<AddressBar step={base} onSend={() => {}} onCancel={() => {}} />);
    expect(screen.getByRole("button", { name: /send/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /cancel/i })).not.toBeInTheDocument();
  });

  it("keeps Send during the busy gate, then swaps to Cancel and calls onCancel", () => {
    vi.useFakeTimers();
    try {
      const onCancel = vi.fn();
      render(<AddressBar step={{ ...base, status: "sending" }} onSend={() => {}} onCancel={onCancel} />);
      // Gated: a sub-250ms call never flips to Cancel.
      expect(screen.getByRole("button", { name: /send/i })).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /cancel/i })).not.toBeInTheDocument();
      act(() => vi.advanceTimersByTime(250));
      expect(screen.queryByRole("button", { name: /send/i })).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
      expect(onCancel).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });
});
```

- [ ] **Step 2: Run it, verify it fails**

Run: `pnpm vitest run src/features/workflow/AddressBar.test.tsx`
Expected: FAIL — the gated test sees Cancel immediately (no gate yet).

- [ ] **Step 3: Implement the gate, width, and press in `AddressBar.tsx`**

Add imports at the top:

```tsx
import { useBusyDelay } from "@/lib/use-busy-delay";
```

Replace `const sending = step.status === "sending";` (currently line 13) with:

```tsx
  const sending = step.status === "sending";
  const showCancel = useBusyDelay(sending, 250); // mirror the draft bar + comet gate
```

Replace the `{sending ? ( … ) : ( … )}` block (currently lines 34-42) with:

```tsx
      {showCancel ? (
        <Button size="sm" variant="ghost" onClick={onCancel} className="min-w-[5rem] text-muted-foreground">
          Cancel
        </Button>
      ) : (
        <Button size="sm" onClick={onSend} className="min-w-[5rem] active:scale-[.97]">
          ▶ Send
        </Button>
      )}
```

- [ ] **Step 4: Run it, verify green**

Run: `pnpm vitest run src/features/workflow/AddressBar.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/features/workflow/AddressBar.tsx src/features/workflow/AddressBar.test.tsx
git commit -m "fix(ui): gate history-panel Send→Cancel swap; stable width + press"
```

---

## Task 4: CallPanel — `onSend` re-entrancy guard

During the pre-gate window the action button still reads "Send" and is clickable. `onSend` must be idempotent so a click while already sending can't start a second call (mirrors the keyboard-path guard at `CallPanel.tsx:108`).

**Files:**
- Modify: `src/features/workflow/CallPanel.tsx:66`
- Test: `src/features/workflow/CallPanel.editable.test.tsx`

- [ ] **Step 1: Write the failing test**

Add inside `describe("CallPanel editable", …)` in `CallPanel.editable.test.tsx`:

```tsx
  it("does not start a second send when already sending (button stays Send pre-gate)", () => {
    const onPatch = vi.fn();
    const sendingStep = { ...draft, status: "sending" as const };
    render(
      <TooltipProvider>
        <CallPanel step={sendingStep} onPatch={onPatch} editable />
      </TooltipProvider>
    );
    // Pre-gate the action button still reads "Send"; clicking it must be a no-op.
    fireEvent.click(screen.getByRole("button", { name: /send/i }));
    expect(onPatch).not.toHaveBeenCalled();
  });
```

- [ ] **Step 2: Run it, verify it fails**

Run: `pnpm vitest run src/features/workflow/CallPanel.editable.test.tsx -t "second send"`
Expected: FAIL — `onSend` runs and calls `onPatch({ status: "sending", … })`, so `onPatch` is called.

- [ ] **Step 3: Add the guard**

In `CallPanel.tsx`, make `onSend` return early when already sending. Change the opening of `onSend` (currently line 66-67):

```tsx
  const onSend = async () => {
    if (step.status === "sending") return; // idempotent: the button stays "Send" during the pre-gate window
    const requestId = newId();
```

- [ ] **Step 4: Run it, verify green**

Run: `pnpm vitest run src/features/workflow/CallPanel.editable.test.tsx`
Expected: PASS (all — the existing Ctrl+Enter test still fires from an idle draft).

- [ ] **Step 5: Commit**

```bash
git add src/features/workflow/CallPanel.tsx src/features/workflow/CallPanel.editable.test.tsx
git commit -m "fix(workflow): make onSend idempotent while a call is in flight"
```

---

## Task 5: ResponsePanel — use `useBusyDelay` for the progress gate

Centralise the 250 ms constant so the comet/underline gate and the button gate can't drift. Behaviour is identical (the existing test advances 300 ms).

**Files:**
- Modify: `src/features/response/ResponsePanel.tsx:42-53`
- Test: `src/features/response/ResponsePanel.test.tsx` (no change — must stay green)

- [ ] **Step 1: Replace the inline timer with the hook**

Add the import near the other imports in `ResponsePanel.tsx`:

```tsx
import { useBusyDelay } from "@/lib/use-busy-delay";
```

Delete the `showProgress` state + its `useEffect` (currently lines 42-53):

```tsx
  // Delay the in-flight progress indicator: fast responses shouldn't flash it
  // (a sub-threshold loader reads as a twitch). Gates both the comet and the
  // tab-underline fade so they stay in lockstep.
  const [showProgress, setShowProgress] = useState(false);
  useEffect(() => {
    if (!sending) {
      setShowProgress(false);
      return;
    }
    const t = setTimeout(() => setShowProgress(true), 250);
    return () => clearTimeout(t);
  }, [sending]);
```

Replace it with the hook (same 250 ms as the address bars):

```tsx
  // Delay the in-flight progress indicator: fast responses shouldn't flash it
  // (a sub-threshold loader reads as a twitch). Same gate as the Send→Cancel
  // button swap (250ms) ⇒ comet and Cancel appear together.
  const showProgress = useBusyDelay(sending, 250);
```

If `useState`/`useEffect` become unused, leave them — they're still used elsewhere in the file (tab reset effect, `barStart` state). Do not remove the imports.

- [ ] **Step 2: Run the existing test, verify still green**

Run: `pnpm vitest run src/features/response/ResponsePanel.test.tsx`
Expected: PASS — "shows the in-flight tab progress bar after a short delay" still passes (advances 300 ms > 250 ms; rerender to success returns false immediately).

- [ ] **Step 3: Commit**

```bash
git add src/features/response/ResponsePanel.tsx
git commit -m "refactor(response): drive the progress gate from useBusyDelay (single 250ms source)"
```

---

## Task 6: Arrival motion — body fade-in

A gentle 120 ms fade on the response body (and the error faces in the Body tab) so a fast body doesn't hard-snap in. The body content is conditionally rendered per state/tab, so it unmounts during "sending" and remounts on arrival — the CSS animation plays once per response for free (no key needed). Send's press affordance already shipped in Tasks 2–3.

**Files:**
- Modify: `src/styles/globals.css`
- Modify: `src/features/response/ResponsePanel.tsx:116-122`
- Test: `src/features/response/ResponsePanel.test.tsx` (no change — must stay green; jsdom ignores CSS animation)

- [ ] **Step 1: Add the `.hs-fade-in` utility to `globals.css`**

Append after the `hs-proto-flash` block near the end of the file (next to the other keyframes):

```css
/* response arrival: a gentle fade so a fast body doesn't hard-snap in. NN/g — a
   ~120ms fade masks the mechanical jump between states. Decorative, so the global
   prefers-reduced-motion reset collapses it to instant. */
.hs-fade-in { animation: hs-fade-in var(--motion-fast) var(--ease-out); }
@keyframes hs-fade-in { from { opacity: 0; } to { opacity: 1; } }
```

- [ ] **Step 2: Wrap the Body-tab results in `ResponsePanel.tsx`**

Replace the success-body line (currently lines 116-118):

```tsx
      {state === "success" && outcome && tab === "body" && outcome.response_json !== null && (
        <ResponseBody json={outcome.response_json} />
      )}
```

with:

```tsx
      {state === "success" && outcome && tab === "body" && outcome.response_json !== null && (
        <div className="hs-fade-in flex min-h-0 flex-1 flex-col">
          <ResponseBody json={outcome.response_json} />
        </div>
      )}
```

Replace the two Body-tab error lines (currently lines 121-122):

```tsx
      {isError && outcome && tab === "body" && <ErrorView outcome={outcome} />}
      {isError && !outcome && error && tab === "body" && <ClientErrorView message={error} />}
```

with:

```tsx
      {isError && outcome && tab === "body" && (
        <div className="hs-fade-in flex min-h-0 flex-1 flex-col">
          <ErrorView outcome={outcome} />
        </div>
      )}
      {isError && !outcome && error && tab === "body" && (
        <div className="hs-fade-in flex min-h-0 flex-1 flex-col">
          <ClientErrorView message={error} />
        </div>
      )}
```

(Trailers/Headers tabs are left untouched — the request was specifically about the response *body*. The wrapper is `flex min-h-0 flex-1 flex-col` so the child's `flex-1` still fills the panel.)

- [ ] **Step 3: Run the response tests, verify green**

Run: `pnpm vitest run src/features/response/ResponsePanel.test.tsx`
Expected: PASS — `getByTestId("monaco")` is still found (now one div deeper); error-face tests still find their text.

- [ ] **Step 4: Commit**

```bash
git add src/styles/globals.css src/features/response/ResponsePanel.tsx
git commit -m "feat(response): gentle 120ms fade-in on body/error arrival"
```

---

## Task 7: Full gate + housekeeping

**Files:**
- Modify: `CLAUDE.md` (Active work line), this plan's status banner.

- [ ] **Step 1: Run the full gate**

```bash
pnpm vitest run
pnpm tsc -p tsconfig.json --noEmit
pnpm build
cargo check
```
Expected: vitest all green (new hook test + updated bar/CallPanel tests); tsc clean; vite build OK; `cargo check` OK (no backend change).

- [ ] **Step 2: Live WebView2 pass (manual)**

`pnpm tauri dev`. Verify against a fast local gRPC method:
1. A <5 ms call: the Send button does **not** flicker to Cancel; no width pop.
2. A slow call (e.g. a deadline-y target): Cancel appears with the comet (~250 ms in), clicking it cancels.
3. The Send tooltip shows only `Ctrl Enter`.
4. Pressing Send shows a subtle press; the response body fades in (not a hard snap) on both fast and slow responses.
5. Spot-check the incidental tab-switch fade (Body↔Trailers↔Body) — confirm it reads as gentle, not distracting. If distracting, follow up by keying the fade on response identity (noted in the spec).

- [ ] **Step 3: Flip Active work + plan banner**

Update this plan's status banner to ✅ and set `CLAUDE.md` "Active work" to point at this feature/branch. Commit:

```bash
git add CLAUDE.md docs/superpowers/plans/2026-06-16-send-response-ui-polish.md
git commit -m "docs: mark send/response UI polish in review"
```

Archiving (plan+spec → `archive/`, CLAUDE.md "Завершённые фичи" entry) happens **after** merge to `main`, per the project's archiving convention — not in this branch.

---

## Self-review

**Spec coverage:**
- Item 1 (tooltip → hotkey only) → Task 2 Step 3. ✅
- Item 2 (jitter): delayed gate hook → Task 1; applied to both bars → Tasks 2 & 3; `minDuration` omitted (documented in hook) ✅; re-entrancy guard → Task 4; stable `min-w` → Tasks 2 & 3; single 250 ms source via ResponsePanel migration → Task 5. ✅
- Item 3 (arrival motion): Send press affordance → Tasks 2 & 3; body 120 ms fade → Task 6; reduced-motion via global reset (no code) ✅; tab-switch incidental flagged for live pass → Task 7 Step 2.5. ✅
- Testing strategy (hook fake-timers; bar gate tests; re-entrancy; visual via live) ✅. Gate commands ✅.

**Placeholder scan:** none — every code/test step shows complete content; exact line anchors given.

**Type/name consistency:** `useBusyDelay(active: boolean, delayMs: number): boolean` defined in Task 1 and called identically (`useBusyDelay(sending, 250)`) in Tasks 2, 3, 5. `showCancel` / `showProgress` are local names, no cross-task contract. `.hs-fade-in` class name matches between Task 6 Step 1 (CSS) and Step 2 (JSX).
