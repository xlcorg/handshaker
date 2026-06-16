# Send button + response polish: tooltip · jitter fix · arrival motion — design

**Date:** 2026-06-16
**Status:** 🎉 DONE 2026-06-16 — implemented, rebased onto `main` and merged fast-forward; archived. Plan: [../../plans/archive/2026-06-16-send-response-ui-polish.md](../../plans/archive/2026-06-16-send-response-ui-polish.md).
**Branch:** `claude/jolly-wright-9523f9` (merged)

## Problem

Three independent UI rough edges around sending a request and showing its
response:

1. **Redundant Send tooltip.** The draft Send button already reads `▶ Send`, yet
   its tooltip repeats the word — `Send Ctrl Enter`
   ([DraftAddressBar.tsx:81](../../../src/features/workflow/DraftAddressBar.tsx)).
   The only information the tooltip adds is the hotkey.

2. **Button jitter on sub-threshold responses.** The action button swaps
   `Send → Cancel` synchronously on `step.status === "sending"` (both
   [DraftAddressBar.tsx:76](../../../src/features/workflow/DraftAddressBar.tsx) and
   [AddressBar.tsx:34](../../../src/features/workflow/AddressBar.tsx)). When a call
   finishes in <5 ms the button flashes into `Cancel` and back, and the
   filled-primary → ghost variant change also pops the button width → visible
   twitch + reflow.

3. **Hard-snapping response body.** The in-flight comet and tab underline already
   wait 250 ms before appearing
   ([ResponsePanel.tsx:45](../../../src/features/response/ResponsePanel.tsx)), so a
   fast response doesn't flash them. But the **response body itself** appears with
   a hard mechanical jump, and the Send click has **no feedback at all** during
   that first 250 ms gate.

## Best-practice basis (sources)

- **delay + minDuration** is the canonical anti-flicker pattern: don't show a busy
  state until the work has run longer than `delay` (fast ops show nothing), and if
  shown, hold it for `minDuration` ([spin-delay](https://github.com/smeijer/spin-delay),
  [dev.to — loading flicker](https://dev.to/kouts/how-to-handle-loading-progress-flicker-11ne)).
- **Time thresholds:** <100 ms reads as instant; <~200 ms needs no indicator; a
  loader is justified roughly from ~1 s
  ([waiting time](https://medium.com/@kaleemkhan/what-is-the-ideal-waiting-time-before-you-show-loading-indicator-cf094528faec),
  [NN/G — animation duration](https://www.nngroup.com/articles/animation-duration/)).
- **Buttons:** a loading state is for actions longer than ~2 s; short actions
  shouldn't be visually disrupted
  ([uxmovement](https://uxmovement.com/buttons/when-you-need-to-show-a-buttons-loading-state/)).
- **Motion duration:** micro-interactions 100–200 ms; a 120–150 ms fade "signals
  the system heard you" and masks the mechanical jump between states; >200–300 ms
  is for large transitions only ([NN/G](https://www.nngroup.com/articles/animation-duration/),
  [equal.design](https://www.equal.design/blog/5-rules-for-motion-in-ui-transitions)).

The project already applies the **delay** half (the 250 ms comet gate). This work
extends that one idea to the button and adds a gentle arrival fade.

## Scope

In scope: the three items above, frontend-only.

**Out of scope / untouched:** backend, IPC, `bindings.ts`; the comet/underline
keyframes themselves (only their gating constant is centralised); tab-switch
behaviour beyond the incidental fade noted below.

## Design

### 1. Tooltip → hotkey only

[DraftAddressBar.tsx:81](../../../src/features/workflow/DraftAddressBar.tsx): drop
the `Send ` text, leaving `<Kbd>Ctrl</Kbd> <Kbd>Enter</Kbd>`. The button's visible
`▶ Send` label keeps the accessible name, so screen-reader semantics are
unaffected. (`AddressBar`'s Send has no tooltip — nothing to change there.)

### 2. Button jitter fix — delayed busy gate

New small shared hook **`useBusyDelay(active: boolean, delayMs: number): boolean`**
— returns `true` only once `active` has stayed `true` continuously for `delayMs`,
and flips back to `false` immediately when `active` goes false. This is the
**delay** half of spin-delay; the timer is cleared on unmount and on `active`
changes.

- `delay = 250 ms`, the **same constant as the comet**, so `Cancel` and the comet
  appear in lockstep. Below 250 ms the button **never changes** → no flash, no
  variant/width pop, no reflow.
- **`minDuration` is deliberately omitted for the button.** `Cancel` is an
  *action*, not a status indicator; holding it ~200 ms after the response already
  landed would offer a meaningless cancel and contradict "show the result." This
  is an intentional deviation from spin-delay's defaults — `minDuration` belongs to
  spinners (the comet), not an actionable button.
- **Re-entrancy guard:** during the `sending && !busy` window the button still
  shows the normal `Send`, so it must not double-fire. Make `onSend` idempotent —
  `if (step.status === "sending") return;` at the top of
  [CallPanel.tsx:66](../../../src/features/workflow/CallPanel.tsx), mirroring the
  keyboard guard already at [CallPanel.tsx:108](../../../src/features/workflow/CallPanel.tsx).
- **Stable width:** give the action-button slot a `min-w` sized to the wider label,
  so the `Send ↔ Cancel` swap on genuinely slow calls doesn't shift neighbours.
- Applied in **both** bars (`DraftAddressBar` editable draft + `AddressBar` history
  re-send). `ResponsePanel`'s inline 250 ms `setTimeout` is replaced by the same
  hook (delay-only) so the 250 ms constant lives in one place and the comet/button
  gating cannot drift apart.

### 3. Arrival motion — Send acknowledgement + body fade

- **Send press feedback:** a ~100 ms `active:` state on the Send button instance
  only (e.g. a subtle `active:scale`/brightness via className — the shared
  `Button` component is **not** modified). This acknowledges the click instantly,
  covering the 0–250 ms window before the comet is allowed to show
  ([NN/G: ~0.1 s = "system heard you"](https://www.nngroup.com/articles/animation-duration/)).
- **Body fade-in:** a `.hs-fade-in` utility in
  [globals.css](../../../src/styles/globals.css) — `opacity 0 → 1` over **120 ms**
  with `--ease-out` — applied to the response result container in `ResponsePanel`
  (the success body and the error views). It plays whenever the result content
  mounts. Per the user's decision the fade plays on **every** response (a 120 ms
  opacity fade is below the twitch threshold and unifies the fast/slow paths).
  - **Reduced motion:** no special handling needed — the existing global
    `@media (prefers-reduced-motion: reduce)` rule already collapses animations to
    ~instant, and the fade is decorative (not status), so it correctly disappears.
  - **Known incidental:** because the body content is conditionally rendered per
    tab, switching `Body ↔ Trailers` and back remounts it, so the fade also plays
    on that tab switch. 120 ms is gentle enough to be acceptable; flagged for the
    live pass — if unwanted, gate the fade on a per-response key so it plays only
    on a *new* response, not on tab re-mounts.

### Error handling

The hook and the fade have no failure modes. `useBusyDelay` is a no-op when
`active` is false (returns false, clears any pending timer). The fade animates a
container that is already conditionally rendered; nothing new can throw.

## Files touched

- [DraftAddressBar.tsx](../../../src/features/workflow/DraftAddressBar.tsx) —
  tooltip text; gate swap via hook; `min-w`; Send press affordance.
- [AddressBar.tsx](../../../src/features/workflow/AddressBar.tsx) — gate swap via
  hook; `min-w`.
- [CallPanel.tsx](../../../src/features/workflow/CallPanel.tsx) — `onSend`
  re-entrancy guard.
- [ResponsePanel.tsx](../../../src/features/response/ResponsePanel.tsx) — replace
  inline 250 ms timer with the hook; wrap result container with `.hs-fade-in`.
- **New** `src/lib/use-busy-delay.ts` (kebab-case, matching `use-fullscreen.ts` /
  `use-prefs.ts`) — the hook + its unit test `use-busy-delay.test.ts`.
- [globals.css](../../../src/styles/globals.css) — `.hs-fade-in` keyframes; the
  Send `active:` style may live here or as a className.

## Testing (TDD, subagent-driven)

- **Hook:** unit test with `vi.useFakeTimers()` — false before `delayMs`, true at
  `delayMs`, immediate false when `active` flips off, timer cleared on unmount.
- **Address bars:** assert that after clicking Send the button is **still `Send`**
  before the gate elapses, and becomes `Cancel` only after
  `vi.advanceTimersByTime(250)`. Update existing tests in
  [CallPanel.editable.test.tsx](../../../src/features/workflow/CallPanel.editable.test.tsx),
  [CallPanel.layout.test.tsx](../../../src/features/workflow/CallPanel.layout.test.tsx),
  and [ResponsePanel.test.tsx](../../../src/features/response/ResponsePanel.test.tsx)
  that expect `Cancel` synchronously.
- **Re-entrancy:** clicking Send while `status === "sending"` does not start a
  second call.
- **Fade / reduced-motion / cross-engine (WebView2 vs WKWebView):** visual, via the
  live `pnpm tauri dev` pass — jsdom has no layout or media-query evaluation.

## Implementation order

1. `useBusyDelay` hook (TDD) + `.hs-fade-in` token in `globals.css`.
2. Tooltip text (item 1) — trivial, can ride with step 3.
3. Button gate: `onSend` guard, hook in both bars, `min-w`; migrate `ResponsePanel`
   timer to the hook; update affected tests.
4. Arrival motion: Send press affordance + body `.hs-fade-in` wrapper.

## Gate

`pnpm vitest` green · `tsc` clean · `vite build` · `cargo check` (no backend change
expected). Live WebView2 pass for the motion and the jitter; macOS/WKWebView pass
deferred per the project's standing convention.
