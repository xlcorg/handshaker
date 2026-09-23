# Remove the default WebView context menu

**Status:** 🎉 DONE — squashed & ff-merged to main 2026-07-13
**Date:** 2026-07-13

## Problem

Right-clicking anywhere in the app currently pops the **native WebView2 context menu**
(Reload / Save as / Back / Inspect…), which breaks the native-desktop feel. Handshaker
already provides purpose-built menus where they matter — Monaco's editor menu
(`src/features/bodyview/`) and the sidebar row menu (`RowMenu`, a Radix `ContextMenu`) —
so the raw browser menu only ever appears on *unhandled* right-clicks. We want that
default menu gone.

There is no suppression today: no global `contextmenu` handler in the frontend, and
nothing in `tauri.conf.json` / `src-tauri/src/lib.rs`.

## Scope (decided)

- **Suppress everywhere except editable text fields.** Keep the native
  copy / paste / select-all menu inside `<input>` (text-like types), `<textarea>`, and
  `contenteditable` elements, where it is genuinely useful. `Ctrl+C` / `Ctrl+V` continue
  to work everywhere regardless.
- **Production only.** In dev builds (`import.meta.env.PROD === false`) leave the native
  menu intact so right-click → *Inspect Element* stays available for debugging. DevTools
  remain reachable via F12 / hotkey in either case.

## Why a frontend JS handler (not a Rust plugin / WebView2 flag)

Tauri 2 has **no native config flag** for this; the canonical approach is a JS
`contextmenu` listener calling `preventDefault()` (Tauri
[discussion #11808](https://github.com/tauri-apps/tauri/discussions/11808),
[wry#30](https://github.com/tauri-apps/wry/issues/30)). The blanket alternatives —
`tauri-plugin-prevent-default` (`CONTEXT_MENU` flag) or the WebView2
`AreDefaultContextMenusEnabled=false` binding (Windows-only; the app ships dmg/icns too) —
**cannot make the input/textarea exception** we require. So a small frontend handler with
per-target logic is the correct fit, and it also matches the existing frontend-owned menu
pattern.

## Design

### Module — `src/features/shell/nativeContextMenu.ts`

Sits alongside the other shell-level concerns (`zoom.ts` / `useUiZoom`, `splash.ts`,
`splitDirection.ts`). Frontend-only; no Rust, no Tauri config, no `messages.ts`
(there are no user-visible strings).

**`decideContextMenu(target, { isProd, alreadyHandled }): "suppress" | "allow"`** — the
whole decision as a **pure function**, unit-testable without env or DOM mocking (mirrors
the codebase's `isPristineBody` / `isAutoName` / `splitDirection` pattern). Order:

1. `!isProd` → `"allow"` — dev keeps the native menu (Inspect).
2. `alreadyHandled` → `"allow"` — a component already called `preventDefault` on the
   event (Monaco, Radix `ContextMenu`); it has shown its own menu, so we stay out.
3. `isEditableTarget(target)` → `"allow"` — keep native copy/paste in text fields.
4. otherwise → `"suppress"`.

**`isEditableTarget(el): boolean`** — helper: walks up via `closest()` and returns true
when the target is/inside a `<textarea>`, a text-like `<input>` (text / search / url /
email / tel / password / number — i.e. not button/checkbox/radio/range/etc.), or an
element with `isContentEditable`.

**`useSuppressNativeContextMenu(): void`** — thin hook. On mount, registers a
`document`-level **bubble-phase** `contextmenu` listener; per event it computes
`decideContextMenu(e.target, { isProd: import.meta.env.PROD, alreadyHandled: e.defaultPrevented })`
and calls `e.preventDefault()` only on `"suppress"`. It **never** calls
`stopPropagation` (that would starve Radix's `ContextMenuTrigger` and break the sidebar
menu). Removes the listener on unmount.

### The `defaultPrevented` guard (key interaction detail)

React attaches its handlers at the root container, below `document`; a bubble-phase
`document` listener therefore runs **after** any component handler. Both Monaco (native
DOM listener) and Radix `ContextMenu` (`onContextMenu` → `SyntheticEvent.preventDefault()`,
which forwards to the native event) have already set `defaultPrevented` by the time the
event reaches our listener. Step 2 reads that flag and leaves those menus completely
untouched — we only ever act on the genuinely-default right-click.

### Wiring

A single `useSuppressNativeContextMenu()` call in `WorkflowApp`, next to `useUiZoom()`.

## Testing

`src/features/shell/nativeContextMenu.test.ts` (vitest + jsdom):

- **`decideContextMenu` table:** dev (`isProd:false`) → allow; `alreadyHandled:true` →
  allow; text `<input>` / `<textarea>` / `contenteditable` targets → allow; `<div>` /
  `<button>` / non-text `<input>` (checkbox) targets → suppress.
- **`isEditableTarget`:** true for textarea / text-input / contenteditable (incl. a child
  node inside a contenteditable via `closest`); false for div / button / checkbox input.

No IPC/DTO shape change, so the gate is **`pnpm lint` + `pnpm test`** (frontend-only;
`cargo test --workspace` unaffected).

## Out of scope / non-goals

- No changes to Monaco's or Radix's existing menus.
- No Rust, `tauri.conf.json`, or WebView2-native changes.
- Not adding a per-element opt-out API — the input/textarea exception is the only
  carve-out.
