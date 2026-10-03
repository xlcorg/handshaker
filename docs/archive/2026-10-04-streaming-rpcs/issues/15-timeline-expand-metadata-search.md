# 15: Timeline — expand row, lazy body, Headers/Trailers, search, error strip

**What to build:** The stream timeline becomes fully usable: clicking a row expands it in
place into the read-only Monaco body view (one row at a time; the full JSON comes inline
for messages ≤ 64 KiB and is fetched on expand via `stream_message` otherwise); the
Headers tab fills at **Stream start** from the `Headers` event and the Trailers tab fills
at **Stream end** (tab hints = counts; unary Headers stays empty); a thin toolbar above the
list carries a search box matching previews with a `shown / total` counter; a non-OK
`End` renders a red strip above the still-visible rows (`<code> <NAME> · message` +
"See trailers" jumping to the Trailers tab) while a client fault before stream start keeps
the existing client-error face; empty states show the pulsing dot ("Stream open — awaiting
messages"); Ctrl/Cmd+Enter and Ctrl+R are a no-op while a server stream is open (never
Cancel) and mean Send again once ended. Rows stay text-only; Monaco mounts only for the
expanded row.

**Blocked by:** 14 (Walking skeleton)

**Status:** resolved

- [x] Expanding a small message shows its pretty JSON without an IPC round-trip; expanding a > 64 KiB message fetches it via `stream_message(request_id, index)` and shows it
- [x] Only one row is expanded at a time; the expanded row's Monaco menu keeps "Save response to file…" for that message
- [x] Headers tab shows initial metadata after stream start; Trailers tab shows trailing metadata after end; hints show counts; unary Headers tab unchanged
- [x] Search filters rows by preview and shows `shown / total`; clearing restores all rows
- [x] Echo `ServerStream` with `fail_after: (k, code)` yields k rows, the red strip with code + message, "See trailers" switches tabs, footer shows the code
- [x] Empty states: idle keeps "Awaiting first call"; open with no messages shows "Stream open — awaiting messages" with the pulsing dot
- [x] Ctrl/Cmd+Enter / Ctrl+R do nothing while a server stream is open; they Send when idle or ended
- [x] Tests: timeline rendering (newest first, expand, lazy fetch), tab hints, search, strip on non-OK `End`, hotkey gating; IPC test for `stream_message`
- [x] Strings of touched files in the messages module
- [x] Gate green: `pnpm lint` + `pnpm test` + `cargo test --workspace`

## Comments

**2026-09-28 — resolved.** Commits on `claude/streaming-rpcs`: `63b14f8` (Rust `stream_message`),
`9c06431` (timeline), `1ecc3d0` (review fixes).

- **Core/IPC**: `StreamCall::message_json(index)` / `StreamRegistry::message_json(request_id,
  index)` decode one stored message lazily (bytes cloned under the lock, decoded outside);
  `CoreError::StreamMessageNotFound { request_id, index }` ↔ `IpcError::StreamMessageNotFound`
  (`from_core_error` 18 → 19); command `stream_message(request_id, index: u32) → String`.
  Echo fixture: configured `trailers` ride the injected `fail_after` status; integration test
  asserts k rows, code, message, trailers and lazy decode of kept rows.
- **Frontend** (`src/features/stream/StreamView.tsx`): `Timeline` (keyed by `entry.id`, one
  `expanded` index) → `TimelineRow` text-only; `ExpandedBody` mounts `BodyView mode="response"`
  only for the expanded row (inline `json`, else `streamMessage` once, cached via
  `streamStore.setMessageJson` even if collapsed mid-fetch; `onSaveBody` → "Save response to
  file…" for that message). `StreamToolbar({ query, onQueryChange, shown, total, filters?,
  actions? })` — search over previews (`filterRows`), `shown / total` while filtering; the
  `filters` slot is for 16's direction chips, `actions` for 18's save/assemble menu. Headers
  tab ← `entry.headers`, Trailers ← `end.trailingMetadata`, hints = counts (`kvRows` shared
  with `ResponsePanel` via `KVTable.tsx`; `useTabBarStart` shared hook). Non-OK `End` → red
  strip `<code> <NAME> · message` + "See trailers" (switches tab); Cancel → no strip. Empty
  state "Stream open — awaiting messages" with the pulsing dot. Hotkey gate = `step.status ===
  "sending"` (live stream keeps `sending`), covers the window listener and Monaco `addCommand`
  path; tested for Ctrl/Cmd+Enter and Ctrl+R live (no-op) and ended/cancelled (Send).
- Strings: `messages.stream.{toolbar,row,body,strip,empty}`, `messages.workflow.fault.*`
  (`netDiagnostics.ts` fully centralized while touched).
- **Gate**: cargo 414 passed; lint clean; vitest 179 files / 1377 tests. Bindings fresh.
- **Review**: no standards violations. Fixed: raw `StreamMessageNotFound` discriminator shown
  to the user; expanded index carrying over to the next call; fetched body discarded on
  collapse; `stream_message` JSDoc; two duplications with `ResponsePanel`. Accepted: the
  `shown / total` counter hides when a non-empty query matches every row.
