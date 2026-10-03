# 16: Client-streaming & bidi — Open / Send message / Half-close

**What to build:** Client-streaming and bidi methods get Postman's interactive model. The
primary button reads `▶ Open`; **Open** runs resolve → auth → activate and puts initial
metadata on the wire but sends no message. While open, a segmented `[Send message ▸]
[□ Half-close] [Cancel]` replaces it: **Send message** emits the current body as one
**Outbound message** (resolve + built-ins fresh per message; auth materialized once at
Open; an invalid body blocks the send and the stream stays open); the ack row (`→`, muted)
shows the **resolved** JSON that went on the wire; messages can be sent before headers
arrive (channel-backed outbound, bounded mpsc, ack = accepted by the transport);
**Half-close** ends the outbound side, disables Send message and Half-close, keeps Cancel,
and starts the phase-2 deadline (Half-close → stream start); half-close with zero messages
is allowed. `stream_open` carries the UI's kind and core picks the outbound shape (`once`
for server-streaming, channel for client/bidi). The footer adds `● OPENING` /
`● HALF-CLOSED`; the toolbar shows `All / Received / Sent` chips for two-way streams;
Ctrl/Cmd+Enter = Send message while a two-way stream is open; empty states "Stream open —
send messages" / "Half-closed — waiting for the server". The deadline pref hint becomes
the two-phase wording from the spec.

**Blocked by:** 14 (Walking skeleton)

**Status:** resolved

- [x] Echo `ClientStream(stream Ping) → Pong { echoed: "count: N" }`: Open, three Send message clicks, Half-close → one `←` row with `count: 3`, footer `● OK`
- [x] Echo `Bidi(stream Ping) → stream Pong`: each Send message produces a `→` row followed by an echoed `←` row; Half-close ends with `● OK`
- [x] Send message before any headers arrive succeeds (ack returned); `stream_send` after half-close returns `Err`, never a silent drop; `stream_send` before `Opened` returns `Err`
- [x] Each Send message re-resolves `{{var}}` and `{{$guid}}`; auth/metadata are not re-materialized (an env switch mid-stream does not change them)
- [x] `ResolveFailed` on Send message shows the unary unresolved face and leaves the stream open
- [x] Phase-2 deadline: a server that never answers after half-close yields `DeadlineExceeded` (`Fault` after Opened) with the unary face; between Open and Half-close no deadline runs
- [x] `stream_open(kind = server)` sends the body as the single outbound message and half-closes; `kind = client | bidi` sends nothing at Open
- [x] Controls morph with the existing busy delay; after half-close only Cancel stays enabled until end
- [x] Filter chips appear only for two-way streams and filter rows by direction; Ctrl/Cmd+Enter sends a message while open
- [x] Pref hint reads: "Per-request deadline. Bounds connecting, and how long the server may take to answer once the client has finished sending; an open stream has no deadline."
- [x] Core tests over `FakeTransport` (captured outbound, ack semantics, half-close, phase-2 timer); IPC tests for `stream_send` / `stream_half_close`; TS fixtures for `OutboundMessageIpc`; hook tests for open / sendMessage / halfClose
- [x] Strings of touched files in the messages module
- [x] Gate green: `pnpm lint` + `pnpm test` + `cargo test --workspace`

## Comments

**2026-09-28 — resolved.** Commits on `claude/streaming-rpcs`: `9ec642d`, `9922827`, `1b163ab`,
`a097afb` (core + IPC + facade), `0380cda`, `9daae42` (frontend), `ffbcead` (review fixes).
Split core+IPC → frontend inside the ticket.

- **Core** (`stream.rs`, `send.rs`, `collections/resolve.rs`): client/bidi Open = bounded mpsc
  (`OUTBOUND_CAPACITY = 1`) as `ReceiverStream` outbound, nothing sent; server = `once(body)`.
  `Sender::prepare(.., kind)` skips body resolve + builtins for two-way kinds (address /
  metadata / auth still materialize once at Open). `StreamCall::send_message(template, coll,
  env)`: `expand_body` (vars + fresh built-ins) → `encode_body` (shared with the Server arm) →
  `reserve()` raced against a terminal `Notify` → store row (shared 1-based index across
  directions) → send; ack = `OutboundMessage { index, at_ms, size_bytes, preview, json }`.
  Outbound sender shared with `run` and dropped on End/Fault/cancel → `Err(StreamClosed)`
  deterministically, no phantom rows. `half_close()` drops the sender (EOS on the wire) and
  arms phase 2 (`phase_timeout` sleeps only after half-close; server pre-arms). New
  `CoreError::StreamClosed { request_id }` (handle knows its id, stamped by the registry).
  `variable_set()` shared by both resolve fns. Echo fixture: `ClientStream` (`count: N`,
  `client_stream_hang`) and `Bidi` (echo each); `fixture_pool()` has all four methods.
- **IPC**: `stream_send(request_id, body_template, ctx) → OutboundMessageIpc`,
  `stream_half_close(request_id) → ()` (`Err(StreamClosed)` for unknown id / after half-close /
  after end); `IpcError::StreamClosed` (`from_core_error` 19 → 20). Facade `streamSend`,
  `streamHalfClose` (named + `ipc`).
- **Frontend**: `useStreamCall → { open, sendMessage, halfClose, cancel }`; `StreamEntry +=
  halfClosed, sendFault`; `streamStore += pushOutbound, halfClose, setSendFault,
  clearSendFault` (sendFault cleared on halfClose / End / Fault / cancel). `DraftAddressBar`
  `twoWay?: TwoWayControls { canSend, onSendMessage, onHalfClose }` → `▶ Open` idle,
  `[Send message ▸][□ Half-close][Cancel]` live (busy delay), first two disabled after
  half-close; `CallPanel` derives it from the live entry's kind (`entry.id === step.requestId`).
  `→` muted ack rows; `All / Received / Sent` chips (`filterRows(messages, query, dir)`) only for
  two-way; Ctrl/Cmd+Enter / Ctrl+R = Send message while a two-way stream is open, no-op while
  a server stream is open or after half-close; footer `● OPENING` / `● HALF-CLOSED`; empty
  states "Stream open — send messages" / "Half-closed — waiting for the server"; deadline
  pref hint = the spec's two-phase wording. `isTwoWay` / `isStreaming` in `method-kind.ts`.
- **Accepted deviations**: (1) `UnresolvedVars` / `EncodeRequest` / `StreamClosed` on Send
  message render as a dismissible strip ("Message not sent · <unary message>") inside the
  stream pane instead of the full `ClientErrorView` face — the timeline must stay visible; the
  message text is the unary one. (2) Outbound index assigned after the transport accepted the
  message (reserve → store → send) — stricter than "store, then await": no never-sent rows.
  (3) `stream_half_close` returns `Result` (spec table says `()`).
- **Gate**: cargo 434 passed; lint clean; vitest 179 files / 1437 tests. Bindings fresh.
- Notes for 17/19: `Opened.kind` still echoes the UI kind (17 adds the descriptor gate);
  idle control label comes from the catalog kind — 19's precedence rule slots in
  `CallPanel`; history `AddressBar` untouched (re-send of a stream snapshot routes unary
  until 17's re-route / 19).

**2026-10-04 — live check.** The half-close button is labelled **End stream** with a lucide
`ArrowRightToLine` icon instead of `□ Half-close`: `□` (U+25A1) is outside the bundled Inter
subsets, so it rendered from an OS fallback font and read as an empty checkbox / Stop. UI label
only — the glossary term Half-close, the `stream_half_close` command, the footer state
`HALF-CLOSED` and the empty state "Half-closed — waiting for the server" are unchanged; the
empty-state description now names the button ("End stream ends your side").
