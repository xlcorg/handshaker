# Streaming response pane prototype

Type: prototype
Status: resolved
Blocked by: 03, 08
Map: ../map.md

## Question

How should the response panel look and behave during and after a stream call? The
design-handoff `StreamView` is explicitly not the baseline. Build a throwaway prototype
(`mattpocock-skills:prototype`) to react to, covering:

- message list vs single document (Monaco `BodyView` reuse vs a lighter list), selection of
  one message into the existing body view, auto-scroll, ordering;
- status strip: running/ended/cancelled, count, elapsed, headers/trailers tabs;
- error arriving after N messages; empty state ("stream open, awaiting messages").

Resolution = the chosen layout (linked prototype) and the interaction rules the spec
states.

## Comments

**2026-09-24, input from [ticket 07](07-sending-model-and-phasing.md)**: the control set
for client/bidi is Open (no message) / Send message (current body, per click) /
Half-close / Cancel; unary and server-streaming keep the single Send. The prototype
decides their labels and placement, plus the Send-button/comet/hotkey behaviour while a
stream is open (map fog).

**2026-09-24, input from [ticket 08](08-inbound-buffer-and-metadata-model.md)**: rows
render from `preview` (~200 chars) + local time from `at_ms`; the full body opens lazily
(inline ≤ 64 KiB, else fetched); for file streams the running figure is
`N msgs · total_bytes`; no retention cap / dropped counter to design; error mid-stream
arrives as `End` with a non-OK status while received rows stay.

**2026-09-25, prototype built (awaiting the human's reaction — HITL, not resolved)**:
three variants mounted on the real Focus(draft) page (sub-shape A), driven by a fake
stream engine; verified live in `pnpm tauri:dev` (screenshots taken of every state).

- Files: `src/features/response/prototype/` (`fakeStream.ts` engine + scenarios,
  `variant.ts` switch, `PrototypeSwitcher.tsx`, `VariantA/B/C.tsx`, `shared.tsx`,
  `useStreamPrototype.tsx` host hook); mount points `CallPanel.tsx` (three slots +
  bottom padding) and `DraftAddressBar.tsx` (`sendSlot` / `kindOverride`); strings under
  `messages.prototype.stream`; `.env.development.local` (`VITE_HS_PROTO=A`) turns it on
  at launch; `.claude/launch.json` gained a `tauri` entry.
- Run: `pnpm tauri:dev` → prototype is on (badge `stream`/`bidi` in the MethodPicker,
  floating bar at the bottom). ◀ ▶ (or ← →) switch variants, the Scenario select picks
  `server · 12 events` / `server · error after 5` / `server · 200 file chunks` /
  `client · upload` / `bidi · chat echo`; Reset clears; ✕ exits (`?variant=off`).
  Ctrl+Shift+F9 toggles (unverified under automation; buttons verified).
- **A · Timeline** — Postman-like newest-first list, row = arrow · #n · preview · size ·
  clock; row expands in place into the Monaco body view; search + Received/Sent filter;
  non-OK end = red strip above the list; status chip in the tab header. Controls in the
  address bar as one morphing group: `▶ Send` → `Cancel` (server), `▶ Open` →
  `[Send message ▸][□][Cancel]` (client/bidi).
- **B · Master-detail** — oldest-first list (w-64) + the full Monaco viewer for the
  selected message, "Follow latest" toggle; status moves to a footer statusline that
  also holds Half-close / Cancel; address bar only `▶ Open` → `● STREAMING` label;
  `Send message ▸` / `Half-close` live in a composer strip under the request body; a
  non-OK end is a red row in the list whose detail is the error face.
- **C · Transcript** — one continuous `tail -f` document: `headers` block, one rule +
  pretty JSON per message (`←`/`→`), `end · <code> …` rule (red/green); auto-scroll with
  a "Jump to latest" pill when scrolled up; a sticky strip inside the pane carries the rpc
  name, elapsed and ALL stream controls; address bar only opens.
- Questions to settle while flipping: list vs document; newest-first vs oldest-first +
  follow; where the client/bidi controls live (address bar / request composer / response
  strip); status in the header chip vs a footer statusline; the error strip vs error row;
  Ctrl+Enter = Send message while open (all three do that).

## Answer

**Chosen: Variant A (Timeline) with the status moved into a footer statusline as in
Variant B.** Prototype captured on branch `prototype/stream-pane`
(`src/features/response/prototype/`, throwaway; nothing of it lands on `main`).
Decided 2026-09-25 by the user after flipping all three variants live.

Interaction rules the spec states:

- **Layout**: the response pane keeps its tab header — `Messages` (hint = count) ·
  `Headers` (hint = count, filled at stream start) · `Trailers` (hint = count, filled at
  end) · `Contract`. The `RespMeta` slot in the header stays **empty** for stream calls;
  the summary lives in a **footer statusline** at the bottom of the pane. Unary keeps its
  current pane untouched.
- **Footer statusline** (`h-7`, `border-t`, mono 11px): `● STREAMING` / `● OPENING` /
  `● HALF-CLOSED` (pulsing stream dot) · `N msgs` · total bytes · elapsed (ticking);
  after end `● OK` / `● <code> <NAME>` (red dot) / `○ Cancelled` (elapsed frozen). The
  footer carries **status only**; the controls stay in the address bar (assumption:
  "status as in B" ≠ "Half-close/Cancel in the footer as in B" — flag if wrong).
- **Timeline** (Messages tab): flat list, **newest first**, no virtualization; a row =
  `←`/`→` arrow (stream colour / muted) · `#index` · single-line `preview` (≤ 200 chars,
  from ticket 08) · size · local clock `HH:MM:SS.mmm`. Clicking a row expands it in place
  into the read-only Monaco body view (one row expanded at a time, ~18rem tall; the full
  `json` inline ≤ 64 KiB, else fetched via `stream_message`). A thin toolbar above the
  list: search box (matches `preview`) and, for client/bidi only, `All / Received /
  Sent` chips; the toolbar shows `shown / total` when filtering.
- **Address-bar controls** (one slot that morphs, 250 ms `useBusyDelay` before any swap,
  same gate as the tab progress comet): server-streaming `▶ Send` → `Cancel`;
  client/bidi `▶ Open` → segmented `[Send message ▸] [□ Half-close] [Cancel]`; after
  half-close `Send message` and `Half-close` disable, `Cancel` stays until end.
  MethodPicker shows the kind badge (`stream` / `client` / `bidi`).
- **Hotkeys**: Ctrl/Cmd+Enter and Ctrl+R = `Open`/`Send` when idle or ended; =
  `Send message` while a client/bidi stream is open; no-op while a server stream is
  open (never Cancel). Tooltip on the buttons shows the chord.
- **Empty states**: idle = the existing "Awaiting first call"; open with no messages =
  "Stream open — awaiting messages" (server) / "Stream open — send messages" (client/
  bidi) / "Half-closed — waiting for the server", each with the pulsing dot.
- **Error mid-stream**: a non-OK `End` renders a **red strip** above the list
  (`<code> <NAME> · message` + "See trailers" jumping to the Trailers tab); received
  rows stay; the footer shows the code. A client fault before stream start (no gRPC
  status) keeps the existing `ClientErrorView` face. Cancel = rows stay, footer
  `○ Cancelled`, no strip.
- **Rendering cost**: rows are text-only (preview); Monaco mounts only for the expanded
  row; channel events are batched per animation frame before touching React state;
  200 file-chunk rows rendered without virtualization in the prototype — virtualization
  is deferred until a real stream stutters.
- **Ordering + follow**: newest-first means the list needs no auto-scroll/follow; the
  top row is always the latest.
