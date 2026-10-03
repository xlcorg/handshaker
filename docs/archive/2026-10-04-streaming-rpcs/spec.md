# Streaming RPCs — spec

Status: ready-for-agent
Map: `map.md` (decision tickets `issues/01`–`12`; research under `research/`)
Written: 2026-09-28 from the wayfinder map's Decisions so far

## Problem Statement

Handshaker can call only unary gRPC methods. Every service the user works with also
exposes server-streaming methods (subscriptions, large payloads delivered in pieces),
client-streaming methods and bidirectional ones. Today those methods appear in the
method picker like any other, but Send fails with "Request failed" (core refuses them
as not implemented), so the user has to fall back to grpcurl or Postman for anything
that streams. Two usage patterns dominate: **subscribing** to a server stream and
watching messages arrive, and **downloading a large file** that the server delivers as
a stream of chunks in a `bytes` field — which the user then wants as one file on disk,
not as N base64 strings.

## Solution

Handshaker calls all four method kinds. For a streaming method the response pane turns
into a **timeline** of messages (newest first) with a footer statusline showing the
live state (`STREAMING`, message count, bytes, elapsed → `OK` / status code /
`Cancelled`). Server-streaming keeps the familiar one-click Send; client-streaming and
bidi get Postman's interactive model: **Open** the stream, **Send message** as many
times as needed (editing the body between clicks), **Half-close** when done, **Cancel**
any time. Received messages are kept without limit and can be saved as one JSON file or
**assembled** into a single file from a `bytes` field. The method picker, address bar and
Contract tab show the method's kind, and core refuses any call whose path does not
match the method's kind before a byte reaches the wire.

## User Stories

### Discovering and selecting streaming methods

1. As a user, I want the method picker to show a `stream` / `client` / `bidi` badge next
   to streaming methods, so that I know before sending which interaction model applies.
2. As a user, I want the address bar to show the kind badge of the selected method (not a
   hardcoded "unary"), so that a saved request I reopen tells me what it is.
3. As a user, I want the Contract tab to print `rpc Name(stream In) returns (stream Out);`
   proto-style, so that the contract reads like the `.proto` I know.
4. As a user, I want no badge and no wrong signature while reflection is still loading,
   so that the UI never claims a method is unary when it simply does not know yet.
5. As a user, I want the badge and the `rpc` line to appear as soon as the catalog
   arrives, without any action from me.

### Server-streaming

6. As a user, I want to press Send on a server-streaming method and see messages appear
   in a timeline as they arrive, so that I can watch a subscription live.
7. As a user, I want the newest message at the top of the timeline, so that I never have
   to scroll to see the latest one.
8. As a user, I want each row to show direction, index, a one-line preview, size and
   the local receive time, so that I can scan a stream at a glance.
9. As a user, I want to click a row and see the full pretty JSON in the read-only body
   view, so that I can inspect one message in detail.
10. As a user, I want large messages (> 64 KiB) to load their body only when I expand the
    row, so that a file stream of megabyte chunks does not freeze the app.
11. As a user, I want a footer statusline with a pulsing `● STREAMING`, message count,
    total bytes and a ticking elapsed time, so that I know the call is alive and how much
    has arrived.
12. As a user, I want the Send button to turn into Cancel while the stream is open, so
    that I can stop a subscription with one click.
13. As a user, I want Cancel to keep everything received so far and show `○ Cancelled`
    with the elapsed time frozen, so that I do not lose data by stopping early.
14. As a user, I want a non-OK stream end to show a red strip with the code and message
    above the still-visible messages, so that an error mid-stream does not hide what was
    received.
15. As a user, I want "See trailers" on that strip to jump to the Trailers tab, so that I
    can read the server's error details.
16. As a user, I want the Headers tab filled at stream start and the Trailers tab filled
    at stream end, so that I can inspect metadata separately from the messages.
17. As a user, I want empty states ("Stream open — awaiting messages") with the pulsing
    dot, so that a silent stream is distinguishable from a dead one.

### Client-streaming and bidi

18. As a user, I want the primary button to read `▶ Open` for client/bidi methods, so
    that I understand the call is opened first and messages are sent separately.
19. As a user, I want Open to send no message, so that I can prepare and send the first
    message deliberately.
20. As a user, I want a segmented `[Send message] [Half-close] [Cancel]` control while the
    stream is open, so that all three actions are one click away.
21. As a user, I want Send message to emit the current body as one outbound message, and
    to be able to edit the body between sends, so that I can drive an interactive session.
22. As a user, I want every Send message to resolve `{{var}}` and built-ins (`{{$guid}}`)
    fresh, so that each message carries current values.
23. As a user, I want sent messages to appear in the same timeline as received ones
    (with a muted `→` arrow), so that I see the conversation in order.
24. As a user, I want the Send message ack to show the **resolved** JSON that went on the
    wire, so that I can verify what the server received.
25. As a user, I want to be able to send messages before the server has answered with
    headers, so that a client-streaming session is not blocked waiting for a server that
    only replies after half-close.
26. As a user, I want Half-close to end my side and keep the stream open until the server
    finishes, so that I get the server's response to my batch.
27. As a user, I want Send message and Half-close disabled after half-close while Cancel
    stays, so that I cannot send into a closed outbound side.
28. As a user, I want half-closing with zero messages sent to be allowed, so that I can
    probe a server's handling of an empty stream.
29. As a user, I want an invalid body to block Send message the same way it blocks unary
    Send, with the stream staying open, so that a typo does not kill my session.
30. As a user, I want `All / Received / Sent` filter chips on two-way streams, so that I
    can focus on one direction.
31. As a user, I want Ctrl/Cmd+Enter to mean Send message while a two-way stream is open,
    so that I can drive the session from the keyboard.
32. As a user, I want Ctrl/Cmd+Enter to be a no-op while a server stream is open (never
    Cancel), so that a reflex keypress cannot kill a subscription.

### Deadline and cancel

33. As a user, I want the single "Request deadline" pref to bound only connecting and
    the server's time to answer after I finish sending, so that a long-lived subscription
    is not killed by a 30 s default.
34. As a user, I want a stream that fails to start within the deadline to show the same
    "Request timed out" face as unary, so that timeouts look consistent.
35. As a user, I want the pref hint to explain the two-phase rule, so that I know why an
    open stream never times out.
36. As a user, I want Cancel to be a client-side state with no fabricated gRPC status, so
    that the status strip never shows a server code the server never sent.

### Saving and assembling

37. As a user, I want Ctrl/Cmd+S on a stream call to save all received messages as one
    JSON array in receive order, so that I can archive a subscription.
38. As a user, I want the expanded row's "Save response to file…" to still save that one
    message, so that I can extract a single message.
39. As a user, I want an "Assemble file from `<field>`…" action when the response type has
    a `bytes` field, so that a chunked download becomes one file on disk.
40. As a user, I want a submenu when several `bytes` fields exist and no action when none
    does, so that the menu only offers what makes sense.
41. As a user, I want Assemble available after stream end (OK or not) and after Cancel, so
    that a partial download is still recoverable.
42. As a user, I want messages without the chosen field to be skipped silently, with the
    toast saying "<size> from N of M messages", so that header/progress messages do not
    break assembly.
43. As a user, I want the default file name taken from a `name` / `file_name` /
    `filename` field of the first message, else `stream-<stamp>.<ext>` with the extension
    sniffed from the first chunk, so that the Save-As dialog usually needs no typing.
44. As a user, I want assembly to stream to disk, so that multi-GB downloads do not
    exhaust memory.
45. As a user, I want the saved-file toast with open / reveal-in-folder, as for unary
    saves, so that the file is one click away.

### Search, history, workflow

46. As a user, I want a search box over message previews with a `shown / total` counter,
    so that I can find one event in a long stream.
47. As a user, I want a Clear-free timeline (no destructive controls), so that I cannot
    accidentally wipe received data.
48. As a user, I want a stream step to survive in the workflow history with its messages
    (until I remove the step or close the workflow), so that I can revisit a past call.
49. As a user, I want the history row (`StepRow`) to show the kind badge and the stream's
    final status (OK / code / Cancelled), so that streams are identifiable in a mixed
    list.
50. As a user, I want a history stream step to re-send / re-open with the right controls
    even though history panels never reflect, so that replaying a past client-streaming
    call works.
51. As a user, I want memory for a stream to be freed when its step goes away, so that
    old subscriptions do not accumulate.
52. As a user, I want no retention cap or "buffer full" interruption, so that a long
    download is never truncated by the tool.

### Safety and errors

53. As a user, I want core to refuse a call whose path does not match the method's kind
    before anything reaches the wire, so that a stale UI cannot silently truncate a stream
    (tonic drops extra messages without an error).
54. As a user, I want the app to re-route once automatically if I pressed Send before the
    catalog knew the kind, so that an early Ctrl+Enter just works instead of erroring.
55. As a user, I want a "Method kind mismatch" face naming both kinds and the remedy if
    the re-route also fails, so that I know to refresh reflection.
56. As a user, I want an `UNAUTHENTICATED` (16) stream end to invalidate the cached OAuth
    token as for unary, so that the next call fetches a fresh one.
57. As a user, I want the unary path and pane to behave exactly as today, so that the
    feature adds no regressions to my main flow.

## Implementation Decisions

Vocabulary: **Stream call**, **Open**, **Half-close**, **Stream start**, **Stream end**,
**Cancel**, **Inbound / Outbound message**, **Stream store**, **Assemble**, **Method
kind** — all defined in the core `CONTEXT.md` (Вызов). ADR-0002 (stream call lives in
core; IPC is an adapter; one channel per call, return-at-Opened) governs the layering.

### Method kind (ticket 12)

- The frontend derives the kind **once, live**, in the call panel from the reflected
  catalog: `MethodKind | null`. That single value feeds the address-bar badge and
  controls, the Contract tab, the hook choice and the Ctrl+Enter path. It is never
  stored on the draft or on a saved request.
- `null` (catalog pending / failed / method absent) = no badge, unary controls, Send
  takes the unary path. The method picker's `SelectedMethod.kind` stays non-nullable and
  receives `kind ?? "unary"`. The `▶ Send` → `▶ Open` morph when a client/bidi catalog
  arrives is accepted.
- **Controls kind precedence**: while a call is live, the kind it was opened with
  (`Opened.kind`); otherwise the catalog kind; otherwise the kind of the step's last
  executed call; otherwise `null`.
- **History**: an executed call's kind is a fact reported by core in `Opened.kind` and kept
  in its Stream store entry; a step with no `streamId` is unary. History panels (which
  never reflect) route by it. `StepRow` shows the badge; the read-only history header does
  not.
- **Contract tab**: `stream` as a keyword token inside the parentheses on each streaming
  side; types stay clickable. While the kind is `null` the signature line is omitted
  (message blocks still render). The per-side message-schema DTO stays flag-free —
  streaming is a method property.
- **Core gate**: one shared descriptor lookup (service → method → `ServiceNotFound` /
  `MethodNotFound` → kind) used by both the unary invoke and `open_stream` before the
  transport is touched. `stream_open` carries the kind the UI chose; core compares it
  with the descriptor and refuses any difference with
  `MethodKindMismatch { service, method, expected, actual }` (a core `MethodKind` enum
  built from the descriptor). On agreement core itself picks the outbound shape
  (`once(body)` for server-streaming, channel for client/bidi).
- Error mapping: `CoreError::MethodKindMismatch` → `IpcError::MethodKindMismatch` 1:1
  (`MethodKindIpc` serialized as `"unary" | "server" | "client" | "bidi"`; the TS
  `MethodKind` becomes the generated type) → new `FaultKind "kind_mismatch"`, face
  "Method kind mismatch", hint naming both kinds and the remedy. `ServiceNotFound` /
  `MethodNotFound` stay in `other`. `NotImplemented` remains only for genuinely unwired
  paths (skip_verify). Server-side `Internal "cardinality violation…"` is **not**
  classified into this face.
- **One-shot re-route**: on `kind_mismatch` from a Send / Open the frontend retries once
  via the path of `actual`. Safe because the refused attempt put nothing on the wire and
  a client/bidi re-route is an Open, which sends nothing. The face shows only if the retry
  mismatches again.
- **Accepted risk**: a server whose contract changed after the contract cache was filled
  is invisible to both UI and core; tonic truncates silently until reflection is
  refreshed.
- **No interim Send gating** on the feature branch; the squash-before-ff rule keeps `main`
  from ever carrying a kind it cannot call.

### Sending model (ticket 07)

- Client-streaming and bidi are **interactive**: Open sends nothing; Send message emits
  the current body as one outbound message per click; Half-close is a separate control;
  Cancel aborts. Unary and server-streaming keep Send = Open + single outbound message +
  half-close in one step.
- Resolve (vars + built-ins) runs **per message** with the env at that moment; auth and
  metadata are materialized **once at Open** and sit in the initial metadata. An env
  switch mid-stream does not touch them.
- A saved request persists **one body**; sent messages live only in the call's timeline.
- All three streaming kinds ship in one release.
- Half-close with zero messages is legal; an invalid body blocks Send message the same
  way it blocks unary Send, the stream stays open.

### Deadline and cancel (tickets 06, 07)

- The one "Request deadline" pref bounds **two phases**: Open → transport connected
  (activate) and Half-close → stream start (initial metadata received). Between them an
  open stream has **no deadline**. For unary and server-streaming half-close is
  immediate, so this reduces to "Send → initial metadata". Expiry before stream start is
  `DeadlineExceeded`, same face as unary; after stream start expiry cannot happen.
- No `grpc-timeout` header is sent on stream calls (it would make the server cancel the
  RPC). The bound is Handshaker's own timer in core (`CallOptions.phase_timeout`).
  Unary keeps its IPC-side timeout — a deliberate asymmetry.
- **Cancel** = client-side terminal state: received messages kept, no gRPC status
  synthesized, trailers empty, elapsed frozen. Cancel never invalidates the OAuth token.
- Pref hint text becomes: "Per-request deadline. Bounds connecting, and how long the
  server may take to answer once the client has finished sending; an open stream has no
  deadline."

### Stream store and events (ticket 08)

- **Core owns the call.** A per-call Stream store keyed by `request_id` holds every
  inbound and outbound message in raw encoded protobuf bytes; JSON decoding is lazy. The
  webview keeps only per-message meta and previews.
- **No retention limit** — no cap, budget, eviction or spill.
- **Per-message event** (inbound): `index` (u32 from 1, one numbering shared with
  outbound), `at_ms` (epoch ms), `size_bytes` (raw encoded size), `preview` (always:
  first ~200 chars of compact JSON), `json` (full pretty proto3-JSON inline only when
  `size_bytes` ≤ 64 KiB, else `null` and fetched on expand via `stream_message`).
  Outbound messages enter the timeline from the Send message ack, which returns the
  same fields plus the resolved JSON.
- **`Headers`** event at stream start for stream calls only; the unary Headers tab stays
  empty (tonic merges trailers into unary metadata; separating them would need
  unary-as-stream, which is out of scope). Client-streaming is called through
  `Grpc::streaming()`, never `client_streaming()`, for the same reason.
- **`End`** = the unary outcome shape minus the body (`status_code`, `status_message`,
  `status_details`, `trailing_metadata`, `elapsed_ms`) plus `message_count` /
  `total_bytes`. A non-OK status mid-stream is the same `End`; messages stay.
- **Store lifetime**: as long as any step (draft or history snapshot) references the
  call; freed on replace (new Open of the same step), on step removal / workflow close
  via `stream_release`, on channel drop (safety net), and on exit.
- **History snapshot** of a stream step = `request_id` + meta list + `End`; bodies stay
  in the store; history does not survive a restart (as today).

### Core / IPC / frontend shape (ticket 11, amended by 12)

**Core**

- One transport method `GrpcTransport::stream_dynamic(channel, path, codec, outbound
  stream of Bytes, metadata, opts) → StreamStart { headers, inbound stream of
  Result<Bytes, StreamEnd> }`; the `await` resolves at stream start. Server-streaming =
  a `once(msg)` outbound; client/bidi = a channel-backed outbound. Always tonic
  `Grpc::streaming()` underneath.
- A new identity `RawCodec` moves raw `Bytes` both ways; core encodes an outbound
  `DynamicMessage` once (bytes → store + wire) and decodes inbound bytes once for
  preview / json / assemble. tonic's per-message size limit still applies.
  `DynamicCodec` stays unary-only.
- `Sender::open_stream(request, collection, env, opts, events) → StreamCall` shares
  resolve → builtins → auth → activate with unary `send`. `StreamCall` is an
  actor-style handle (bounded outbound mpsc, descriptors, OAuth invalidation, its Stream
  store); the call body is a spawned task. A core `StreamRegistry` (`request_id` →
  `StreamCall`) owns the handles; the Tauri app state holds an `Arc` to it.
- Events via a callback: `Opened { kind, auth_used, tls_used, bytes_fields }` (activate
  done, call in flight; Send message allowed from here) → `Headers { metadata }` →
  `Message { … }` (inbound only) → terminal `End { … }` **or** `Fault { error }`
  (client-side termination after Opened, e.g. phase-2 deadline). Transport errors after
  Open arrive as `End` with the status; trailers-only non-OK = `End` with zero messages.
  Cancel is not an event.
- Token invalidation: `End.status_code == 16` (incl. trailers-only) invalidates as unary
  does; no auto-retry.
- `bytes_fields` (Assemble candidates) computed from the output descriptor at Open and
  delivered in `Opened`; the catalog DTO is untouched.
- `send_message`: body-only resolve (`resolve_body` over the same accumulator, no auth
  re-materialization) + built-ins, encode, store, then `await` the bounded mpsc send —
  the ack means "accepted by the transport". After half-close → `Err` (invalid state).
  `ResolveFailed` = the unary unresolved face; the stream stays open.

**IPC** (`stream_*` commands; `grpc_cancel` remains the single cancel entry and checks the
unary in-flight registry first, then the stream registry)

| Command | In → Out | Note |
|---|---|---|
| `stream_open` | draft, ctx, request_id, **kind**, opts, on_event channel → `Result<(), IpcError>` | resolves at `Opened`; `Err` = pre-Open fault (incl. `MethodKindMismatch`) |
| `stream_send` | request_id, body_template, ctx → `Result<OutboundMessageIpc, IpcError>` | ack with resolved JSON; `Err` before Opened / after half-close |
| `stream_half_close` | request_id → `()` | drops the outbound sender; starts phase-2 timer |
| `grpc_cancel` | request_id → `()` | existing |
| `stream_message` | request_id, index → `String` | full pretty JSON on demand |
| `stream_release` | request_id → `()` | frees the store |
| `stream_save_messages` | request_id → `Option<String>` | all inbound as one JSON array → Save-As |
| `stream_assemble` | request_id, field_path → `Option<AssembleResultIpc { path, written, total, size_bytes }>` | streamed write → Save-As |

`StreamEventIpc` is the tagged-union mirror of the core events, typed by tauri-specta as
a `TAURI_CHANNEL`. The IPC race for stream commands handles cancel only. Bindings are
regenerated and TS fixtures added for every new DTO; the gate is `pnpm lint` + full
`pnpm test` + `cargo test --workspace`.

**Frontend**

- The IPC facade grows `streamOpen` (wraps a `Channel`), `streamSend`,
  `streamHalfClose`, `streamMessage`, `streamRelease`, `streamSaveMessages`,
  `streamAssemble`; `grpcCancel` unchanged.
- A separate `streamStore` (`useSyncExternalStore`) keyed by `requestId`:
  `{ kind, phase, headers, messages: MessageMeta[], end, cancelled, bytesFields,
  openedAt }`; only the response pane subscribes; channel events are batched per
  animation frame. `Step` gains `streamId: string | null`; `Step.outcome` stays
  unary-only.
- **Release rule** in one place: after every workflow-store transition, diff the set of
  `streamId`s referenced by any step before/after and call `stream_release` for each id
  that disappeared. A focus-mode snapshot copies the `streamId`; the draft's next Open
  gets a fresh id.
- `Step.status`: `"sending"` while live (any phase); `End` OK → `"ok"`, non-OK →
  `"error"`; Cancel → new `"cancelled"` (unary keeps `"draft"` on cancel).
- New hook `useStreamCall({ step, envName, onPatch, record, origin })` →
  `{ open, sendMessage, halfClose, cancel }`; helpers shared with `useSend` (draft
  extraction, executed snapshot, usage bump); the call panel picks the hook by kind.
- **Stream-snapshot summaries**: the address-bar status chip and the step summary read a
  stream's `End` (OK / code) or `Cancelled` — the same as the footer — instead of the
  unary-only outcome; `"cancelled"` handled.

### Response pane (ticket 09; prototype on branch `prototype/stream-pane`, throwaway)

- Tabs: `Messages` (hint = count) · `Headers` · `Trailers` · `Contract`. The header meta
  slot stays empty for stream calls; the summary lives in a **footer statusline** (mono,
  one line): `● STREAMING` / `● OPENING` / `● HALF-CLOSED` (pulsing dot) · `N msgs` ·
  total bytes · ticking elapsed; after end `● OK` / `● <code> <NAME>` (red) /
  `○ Cancelled` (frozen). The footer carries **status only**.
- Timeline: flat, newest first, no virtualization; row = `←`/`→` arrow · `#index` ·
  single-line preview · size · local `HH:MM:SS.mmm`. Click expands in place into the
  read-only Monaco body view (one row at a time). Toolbar: search over previews; `All /
  Received / Sent` chips for two-way streams; `shown / total` when filtering; an icon
  opening the Save messages / Assemble menu (enabled only in a terminal state).
- Address-bar controls = one morphing slot gated by the existing 250 ms busy delay:
  server-streaming `▶ Send` → `Cancel`; client/bidi `▶ Open` → `[Send message ▸]
  [□ Half-close] [Cancel]`; after half-close the first two disable, Cancel stays.
- Hotkeys: Ctrl/Cmd+Enter and Ctrl+R = Open/Send when idle or ended; Send message while a
  two-way stream is open; no-op while a server stream is open.
- Empty states with the pulsing dot: "Stream open — awaiting messages" (server) /
  "Stream open — send messages" (client/bidi) / "Half-closed — waiting for the server".
- Non-OK `End` = red strip above the list (`<code> <NAME> · message` + "See trailers");
  a client fault before stream start keeps the existing client-error face; Cancel = no
  strip.
- Rows are text-only; Monaco mounts only for the expanded row.

### Export and assembly (ticket 10)

- **Save messages**: Ctrl/Cmd+S on a stream call and the toolbar action save all inbound
  messages as one JSON array (oldest first), built in core; default name follows the
  unary `response-<stamp>.json` convention; outbound excluded. The expanded row's
  Monaco menu keeps "Save response to file…" for one message.
- **Assemble**: candidates = every non-repeated `bytes` field of the response type,
  top-level or through nested single-message paths; one → one action, several →
  submenu, none → hidden. Offered in every terminal state (End OK / non-OK / Cancel),
  never while open. Core streams to disk through a `Write` sink (a sink-taking sibling of
  the existing save-via-dialog helper), never one `Vec`. Messages without the field
  contribute 0 bytes; the toast reports "<size> from N of M messages" and names a non-OK
  state. Default name from a `name` / `file_name` / `filename` string field of the first
  inbound message, else `stream-<stamp>.<ext>` via the existing content classifier over
  the first chunk, `.bin` when unknown.

### Strings, glossary, records

- Every new or touched user-facing string lives in the messages module (`ui-strings.md`);
  touching the client-error face titles, the diagnostics hints, the kind-badge labels and
  "Select a method" moves those files' existing inline strings there too.
- Glossary terms already added: Stream call, Inbound / Outbound message, Half-close,
  Stream end, Cancel, Open, Stream start, Stream store, Assemble, Method kind (core
  `CONTEXT.md`) and the UI rule for Method kind (frontend `CONTEXT.md`). ADR-0002 written.

## Testing Decisions

A good test exercises external behaviour at a seam and never the internals: what events
a stream call emits for a scripted inbound stream, what the IPC layer serializes, what
the timeline renders for a given event sequence, which command a hook calls. Seams, from
highest to lowest, all but one already existing:

1. **Echo fixture (highest, real tonic)** — the in-repo echo server grows
   `ServerStream(Ping) → stream Pong` (configurable count, optional `fail_after: (k,
   code)`), `ClientStream(stream Ping) → Pong { echoed: "count: N" }`, `Bidi(stream
   Ping) → stream Pong` (echo each), and `Download(Ping) → stream Chunk { name, data:
   bytes }` for Assemble. The only place the real bidi wire path (headers, trailers-only,
   RST on cancel, phase-2 deadline against a slow handler) is exercised. Prior art: the
   existing echo-server integration tests.
2. **`Sender::open_stream` over `FakeTransport` (core, no network)** — `FakeTransport`
   gains `stream_dynamic` with a scripted inbound `Vec<Result<Bytes, StreamEnd>>` +
   headers and captured outbound; events are collected through the callback. Covers
   spine composition (resolve → builtins → auth → activate), auth-once / resolve-per-
   message, token invalidation on 16, both deadline phases, store indexing, the kind gate
   in both directions (unary path → streaming method; `open_stream` with a wrong kind
   incl. server ↔ bidi; transport untouched on refusal), Save messages and Assemble over
   the store (skipped messages, name field, sniffed extension). Prior art: the existing
   `Sender::send` tests over `FakeTransport`.
3. **IPC `*_impl` functions with a real `Channel`** — `stream_open_impl` takes a real
   `Channel<StreamEventIpc>` built with `Channel::new(|body| …)` (constructible without a
   webview); tests assert on the serialized events, on `Err` for pre-Open faults
   (`MethodKindMismatch` mapping, exhaustive `from_core_error` count 17 → 18), and on
   `grpc_cancel` reaching the stream registry. Prior art: existing `grpc_send_impl`
   tests.
4. **Vitest** — fixtures for every new DTO (`StreamEventIpc`, `OutboundMessageIpc`,
   `AssembleResultIpc`, `MethodKindIpc`); `streamStore` unit tests (per-frame batching,
   release-rule diff); `useStreamCall` with the two-shape `@/ipc/client` mock (open /
   send / half-close / cancel call the right facade functions; one-shot re-route on
   `kind_mismatch`, face on a second mismatch); `faultFromIpcError` → `kind_mismatch`;
   `DraftAddressBar` badge from the catalog and none when `null`; controls-kind
   precedence (live → catalog → last executed → null); `renderContractDoc` modifiers for
   all four kinds and the omitted line for `null`; timeline rendering (newest first,
   filter chips, red strip on non-OK `End`, `○ Cancelled`); history re-send routing by
   executed kind; `StepRow` badge and stream status. Prior art: existing `useSend`,
   `netDiagnostics`, `MethodPicker` and response-pane tests.

No new seam is introduced: `GrpcTransport` (already faked), the `*_impl` boundary, the
IPC facade mock and React Testing Library cover everything. The gate for the feature is
`pnpm lint` + full `pnpm test` + `cargo test --workspace` (IPC shape changes are
invisible to a cargo-only gate).

## Out of Scope

- **Unary-as-stream unification** — the unary path (`invoke_unary` → `UnaryOutcome`, its
  IPC-side timeout, its empty Headers tab) is untouched.
- **Live testing against a real streaming server** — none is available; the echo fixture
  is the only server.
- **Outbound batch / chunked sending** (a file as N outbound messages) and any persisted
  message list on a saved request — one body only.
- **Reflection streaming** — already implemented separately.
- **Retention limit / spill to disk** for the Stream store; **progressive assembly**
  (write-as-you-go) — both would be separate efforts.
- **Timeline virtualization** — deferred until a real stream stutters (200 rows rendered
  fine in the prototype).
- **Postman's synthesized `1 CANCELLED` status** and whole-call deadline — rejected, not
  deferred.
- Classifying server-side cardinality errors (`Internal "cardinality violation…"`) into
  the kind-mismatch face — not portable across stacks.

## Further Notes

- **Ticket ordering constraint for `/to-tickets`**: implementation tickets are numbered
  **after** the decision tickets (from `13`). The **first** implementation ticket is a
  walking skeleton that threads **server-streaming end to end** — core `stream_dynamic`
  + `RawCodec` → `open_stream` + registry → `stream_open` + `Channel` → `streamStore` →
  a minimal timeline + footer — so the badge, the pane and the transport arrive in one
  slice. Client/bidi controls, Save/Assemble, the kind gate + re-route, the Contract
  line, history summaries and string hygiene widen that path in later tickets.
- The `stream_open` return-at-Opened design and the core registry replace research 05's
  "pending-until-end" recommendation; ADR-0002 records why.
- The prototype branch `prototype/stream-pane` is a visual reference only; nothing on
  it lands on `main`.
- The three Postman research files (`research/postman-*.md`) and the tonic / Tauri fact
  sheets (`research/tonic-dynamic-streaming.md`, `research/tauri-progressive-ipc.md`)
  are the primary-source backing for the wire and IPC facts above; the ticket-12
  research files back the kind-handling rules.
