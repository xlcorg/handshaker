# Wayfinder map: streaming RPCs

Label: `wayfinder:map` · Effort dir: `docs/archive/2026-10-04-streaming-rpcs/` · Charted 2026-09-24

## Destination

A spec at `docs/archive/2026-10-04-streaming-rpcs/spec.md` (written with `/to-spec` from the decisions
below) that lets `/to-tickets` + `/implement` ship support for calling server-streaming,
client-streaming and bidi gRPC methods from Handshaker: transport + Send spine branch in
core, progressive IPC delivery, and a reconsidered streaming response surface.

## Notes

**Settled while charting** (no ticket; these fix the scope):

- All three kinds (server / client / bidi) are in scope of the one spec; phasing is an open
  ticket, not a given.
- Unary stays on its current path (`invoke_unary` → `UnaryOutcome`); streaming is a
  parallel branch of the Send spine sharing resolve → builtins → auth → activate.
  Unary-as-stream unification is out of scope.
- The usage model is **read-oriented**: streams are mostly consumed (subscriptions, large
  payloads delivered in pieces). Whether client/bidi sends one outbound message or many is
  an open ticket, decided against Postman's behaviour.
- **Postman is the reference product**: where the user was asked for a preference on
  lifecycle/presentation questions, the answer was "do what Postman does" → research
  tickets first, decisions after.
- The design handoff's deferred `streaming` scenario (`docs/design_handoff_handshaker/panels.jsx`
  `StreamView`) is **not** the baseline; the response surface is reconsidered (prototype).
- Testing: no real streaming server exists; the in-repo echo fixture
  (`crates/handshaker-core/tests/common/mod.rs`, `spawn_echo_server`) is extended with
  streaming rpcs. No "stand up a server" task.
- Glossary terms added to `crates/handshaker-core/CONTEXT.md` (Вызов): **Stream call**,
  **Inbound / Outbound message**, **Half-close**, **Stream end**. "Frame" is avoided.

**Current-code facts every ticket can rely on** (surveyed 2026-09-24):

- Core: `GrpcTransport` has only `unary_dynamic`; `invoke_unary` rejects streaming with
  `NotImplemented` (`grpc/invoke/mod.rs:130`). `DynamicCodec` is per-message and already
  exercised through `tonic::Streaming` in tests. Reflection already uses tonic bidi
  streaming (`grpc/reflection/v1.rs`) outside the transport trait.
- IPC: `grpc_send` is one awaited call under `race_cancel_timeout` (Notify keyed by
  `request_id` + timeout over the whole Send). `tauri::ipc::Channel` is unused; the only
  event is `ContractUpdated`.
- Frontend: `Step.requestJson` is one string; `Step.outcome: InvokeOutcomeIpc | null`;
  Headers tab is always empty; BodyView remounts Monaco on every response value change;
  kind is hardcoded `"unary"` in `DraftAddressBar`, Send is not gated for streaming methods.
- Catalog/IPC already carry `client_streaming` / `server_streaming`; `deriveKind` exists.

**Skills to consult**: `mattpocock-skills:grilling` + `mattpocock-skills:domain-modeling`
on every decision ticket; `mattpocock-skills:research` for research tickets;
`mattpocock-skills:prototype` for the pane prototype. Conversation runs in Russian; all
files here are English (`.claude/rules/specs-plans-language.md`).

**Handoff**: when the frontier is empty, run `/to-spec` and write
`docs/archive/2026-10-04-streaming-rpcs/spec.md` from Decisions so far. `/to-tickets` then numbers
implementation tickets **after** the decision tickets in `issues/`.

## Decisions so far

<!-- one line per resolved ticket: [title](issues/NN-slug.md): gist -->

- [Postman: streaming call lifecycle](issues/01-postman-stream-lifecycle.md): one
  "Connection Timeout" = whole-call gRPC deadline, default infinite, also bounds streams;
  Cancel keeps received messages and ends with gRPC `CANCELLED` in the normal status slot;
  End Streaming = half-close; status/metadata/trailers are strips separate from the
  message timeline.
- [Postman: sending model for client/bidi](issues/02-postman-sending-model.md):
  interactive only (Invoke opens the stream, Send per message, End Streaming half-closes);
  a saved request persists one message body; all four kinds shipped together; one timeline
  (sent + received, newest first) for every streaming kind.
- [Postman: streaming response presentation](issues/03-postman-stream-presentation.md):
  flat newest-first timeline (arrow + truncated JSON + timestamp + expand), search +
  sent/received filter + Clear/Restore; no retention cap or memory guard; Metadata and
  Trailers as separate tabs; no file export of received messages and no bytes→file
  assembly (Handshaker's ticket 10 goes beyond Postman); status = `STREAMING`/`IDLE` badge
  + `0 OK` chip + total elapsed, no message counter.
- [tonic 0.14: dynamic streaming facts](issues/04-tonic-dynamic-streaming-facts.md):
  `DynamicCodec` works as-is for `server_streaming` / `client_streaming` / `streaming`;
  half-close = request stream ending (`tokio_stream::once` for one message); headers on
  `Response::metadata()` before the first message; end = `message()` → `Ok(None)` or one
  `Err(Status)` whose `metadata()` carries the trailers; cancel = drop (RST_STREAM CANCEL);
  `grpc-timeout` bounds only call-to-headers client-side → a whole-call cap needs our own
  `tokio::time::timeout`; size limits are per message; `ready()` before every call.
- [Tauri 2: progressive IPC facts](issues/05-tauri-progressive-ipc-facts.md): per-call
  `tauri::ipc::Channel<T>` is the documented streaming mechanism (ordered, no
  backpressure, `< 8 KiB` inlined else fetched, ~200 ms per 10 MB on Windows);
  tauri-specta types it as `TAURI_CHANNEL<T>` (verified with a probe); JS has no close
  hook → stream end is an explicit event variant; keep the command pending-until-end under
  the existing `race_cancel_timeout` (cancel = drop), `Err` only for pre-stream failures.

- [Deadline and cancel semantics for a stream call](issues/06-deadline-and-cancel-semantics.md):
  the one "Request deadline" pref bounds only stream start (Send → initial metadata);
  an open stream has no deadline and no `grpc-timeout` header is sent (the server would
  cancel the RPC at the deadline); Cancel keeps received messages and is a client-side
  terminal state ("Cancelled", no synthesized gRPC status, elapsed frozen); hint string
  updated; glossary term **Cancel** added. *Amended by ticket 07: for client/bidi the
  deadline bounds Open to connected and Half-close to stream start instead.*
- [Sending model for client/bidi and delivery phasing](issues/07-sending-model-and-phasing.md):
  interactive (Open sends nothing; Send message per click, resolve + builtins per
  message, auth once at Open; Half-close a separate control); all three kinds in one
  release; saved request keeps one body; deadline generalized to two phases
  (Open to connected, Half-close to stream start) because client-streaming headers arrive
  only after half-close; outbound must be sendable before headers (constraint for 11);
  glossary term **Open** added.

- [Inbound buffer and metadata model](issues/08-inbound-buffer-and-metadata-model.md):
  core owns the call in a **Stream store** of raw encoded messages (no retention limit,
  freed with the step); per-message event = `index` / `at_ms` / `size_bytes` / `preview`
  (always) / `json` (inline ≤ 64 KiB, else fetched on expand); `Headers` event at stream
  start for streams only (unary Headers tab stays empty); `End` = unary status shape minus
  body plus totals; history snapshot = meta + `End`; glossary **Stream start**,
  **Stream store**.
- [Streaming response pane prototype](issues/09-stream-pane-prototype.md): Variant A
  "Timeline" (newest-first rows: arrow · #n · preview · size · clock, row expands in place
  into Monaco, search + Received/Sent filter, red end strip on a non-OK status) with the
  status in a **footer statusline** (● STREAMING · N msgs · bytes · elapsed → OK / code /
  Cancelled); controls stay in the address bar as one morphing slot (`Send`→`Cancel`,
  `Open`→`[Send message][Half-close][Cancel]`); Ctrl+Enter = Send message while a two-way
  stream is open; no virtualization; prototype on branch `prototype/stream-pane`.
- [Export from a stream: save messages and assemble a file from a bytes field](issues/10-export-and-file-assembly.md):
  Ctrl/Cmd+S = all inbound messages as one JSON array (core builds it from the Stream
  store, outbound excluded); **Assemble** = descriptor-driven `bytes`-field pick (one →
  action, several → submenu, none → hidden), offered in every terminal state incl. Cancel,
  streamed to disk in core, messages without the field skipped ("N of M" in the toast),
  default name from a `name`/`file_name` field else `stream-<stamp>.<ext>` via
  `classify`; actions live in the timeline toolbar; glossary **Assemble** added.
- [Core / IPC shape for a stream call](issues/11-core-ipc-shape.md): one
  `GrpcTransport::stream_dynamic` over raw `Bytes` (`RawCodec`), `await` = headers;
  `Sender::open_stream` → actor-style `StreamCall` handle in a core `StreamRegistry`
  (`AppState` holds an `Arc`); two-phase deadline in core (`CallOptions.phase_timeout`);
  events `Opened / Headers / Message / End / Fault` over one `Channel` per call,
  `stream_open` resolves at `Opened`; commands `stream_send` (bounded mpsc, ack =
  accepted; `Err` after half-close) / `stream_half_close` / `stream_message` /
  `stream_release` / `stream_save_messages` / `stream_assemble`, `grpc_cancel` shared;
  frontend `streamStore` keyed by `requestId` + `Step.streamId`, status `"cancelled"`,
  `useStreamCall`, one release rule (diff of referenced ids); tests = FakeTransport
  script + real `Channel::new` + echo `ServerStream/ClientStream/Bidi/Download`;
  ADR-0002 written.
- [Surfacing the method kind in the UI](issues/12-surfacing-the-kind.md): kind derived
  live from the catalog in one place (`null` = unknown → unary controls, never stored);
  `stream_open` carries the UI's kind and `Opened` reports it (amends 11); one shared core
  descriptor gate → `MethodKindMismatch { expected, actual }` → `kind_mismatch` face, with
  a one-shot frontend re-route by `actual`; Contract `rpc Name(stream In) returns (stream
  Out)`, signature omitted while unknown; no interim gating — first implementation ticket
  is a server-streaming walking skeleton; history routes by executed kind, `StepRow`
  shows the badge; stream summaries read `End`/`Cancelled`; glossary **Method kind**.

**Frontier empty (2026-09-28)** — every ticket resolved; next step is the handoff:
`/to-spec` → `docs/archive/2026-10-04-streaming-rpcs/spec.md`.

## Not yet specified

_(empty — the fixture extension graduated into ticket 11, rules 16–18)_

## Out of scope

- **Unary-as-stream unification** — decided while charting: unary path untouched.
- **Live testing against a real streaming server** — none available; fixture only.
- **Outbound batch / chunked sending** (a file as N outbound messages) — not wanted;
  the user's "assemble chunks" need is inbound (ticket 10). Postman has none either.
- **Persisted message list on a saved request** — one body only (ticket 07); a
  scenario/example entity would be a separate effort.
- **Reflection streaming** — already implemented separately, not part of this effort.
- **Unary Headers tab** — tonic merges trailers into unary `metadata()`; clean headers
  need unary via `server_streaming`, i.e. the unification above (ticket 08).
- **Retention limit / spill to disk for the Stream store** — the user chose no limit
  (ticket 08); a bytes budget or temp-file spill would be a separate effort.
- **Progressive assembly (write-as-you-go)** — the user chose terminal-state-only
  assembly (ticket 10); a pre-Open path pick + live append would be a separate effort.
