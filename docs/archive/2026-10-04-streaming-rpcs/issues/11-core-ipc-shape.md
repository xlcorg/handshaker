# Core / IPC shape for a stream call

Type: grilling
Status: resolved
Blocked by: 04, 05, 06, 07, 08, 10
Map: ../map.md

## Question

With transport facts (04), IPC delivery facts (05) and the behavioural decisions (06, 07,
08, 10) settled, decide the architecture the spec states:

- **Core**: the streaming branch of the Send spine — `Sender::send_stream` (or similar)
  sharing resolve → builtins → auth → activate with unary; new `GrpcTransport` method(s)
  (`server_streaming_dynamic` / `streaming_dynamic`) and the core-side event type
  (headers / message / end); how token invalidation on UNAUTHENTICATED applies when the
  status arrives at stream end; `CallOptions` growth.
- **IPC**: command shape (`grpc_send_stream` with a `Channel<StreamEventIpc>`?), reuse of
  the `request_id` + Notify cancel path, DTOs (`*Ipc` mirrors), bindings regen, what the
  command's return value is vs what flows on the channel.
- **Frontend**: `client.ts` facade shape, where the stream state lives (workflow store
  `Step` extension vs a separate stream slice), `useSend` split.
- **Testing**: fixture extension (echo server streaming rpcs), `FakeTransport` growth,
  vitest fixtures for the new DTOs (an IPC-shape change must run `pnpm lint` + full
  `pnpm test`).

Resolution = the layered design the spec states, plus any ADR if a trade-off is hard to
reverse (e.g. channel-per-call vs global events).

## Answer

Resolved 2026-09-26 (grilling, fifteen single-question rounds; Q3, Q13, Q14 checked
against primary sources — grpc-go `ClientStream`, grpc-node streaming API, Alice Ryhl's
actor pattern, Tauri 2 state / `ipc::Channel` docs, tonic 0.14.6 sources). The layered
design the spec states:

### Core

1. **One transport method.** `GrpcTransport::stream_dynamic(channel, path, codec,
   outbound: BoxStream<Bytes>, metadata, opts) -> Result<StreamStart, CoreError>` with
   `StreamStart { headers, inbound: BoxStream<Result<Bytes, StreamEnd>> }`; the `await`
   resolves at stream start (headers). Server-streaming = the same method with a
   `once(msg)` outbound; client-streaming and bidi feed a channel-backed outbound.
   Always tonic `Grpc::streaming()` underneath (never `client_streaming()`, which merges
   trailers into headers). Rejected: two or three kind-specific methods.
2. **Raw bytes at the seam.** A new identity `RawCodec` in `transport/codec.rs` streams
   `Bytes` both ways. Core encodes an outbound `DynamicMessage` once (bytes → Stream store
   + wire) and decodes inbound bytes once (`DynamicMessage::decode(desc, &bytes)`) for
   preview / json / assemble. tonic enforces `max_message_bytes` in
   `Streaming::decode_chunk` before the codec runs, so the size limit survives.
   `DynamicCodec` stays unary-only. Rejected: `DynamicMessage` at the seam + re-encode.
3. **The call lives in core.** `Sender::open_stream(request, collection, env, opts,
   events) -> Result<StreamCall, CoreError>` shares resolve → builtins → auth → activate
   with `send`. `StreamCall` is an actor **handle** (bounded outbound `mpsc::Sender`,
   descriptors, `invalidate_oauth`, its Stream store); the call body is a `tokio::spawn`ed
   task inside `open_stream`. A core `StreamRegistry` (`request_id` → `StreamCall`) owns
   the handles; `AppState` holds an `Arc<StreamRegistry>`; IPC commands are thin
   adapters. Rejected: registry in `AppState` (splits one entity across layers — the
   anti-pattern ADR-0001 exists for).
4. **Deadline in core.** `CallOptions` gains `phase_timeout: Option<Duration>`.
   `open_stream` wraps activate (phase 1); `half_close()` starts the phase-2 timer over
   the wait for headers. Expiry before stream start is a client fault (`DeadlineExceeded`,
   same face as unary); after stream start expiry cannot happen. The IPC race for the
   stream command handles cancel only, no timeout. Unary keeps its IPC-side timeout
   (deliberate asymmetry; unification out of scope).
5. **Core events** via a callback `Arc<dyn Fn(StreamEvent) + Send + Sync>` (same shape as
   `Channel::new`): `Opened { auth_used, tls_used, bytes_fields }` (activate done, call in
   flight; Send message allowed from here) → `Headers { metadata }` (stream start) →
   `Message { index, at_ms, size_bytes, preview, json? }` (inbound only) → terminal
   `End { status_code, status_message, status_details, trailing_metadata, elapsed_ms,
   message_count, total_bytes }` **or** `Fault { error }` (client-side termination after
   Opened: phase-2 deadline). No separate `Error`: transport errors after Open arrive as
   tonic `Err(Status)` → `End` with that code; trailers-only non-OK = `End` with zero
   messages. Cancel is not an event (the frontend marks it on the cancel ack and ignores
   later events).
6. **Token invalidation** — unary rule applied to `End.status_code == 16` (incl.
   trailers-only) inside `StreamCall`; Cancel never invalidates; no auto-retry.
7. **`bytes_fields`** (Assemble candidates, ticket 10) computed in core from the output
   descriptor at open and delivered in `Opened`; the catalog DTO is untouched.
8. **Outbound rules.** `send_message` runs a body-only resolve (new
   `resolve_body(template, collection, env)` over the same `ResolveAcc`; no auth
   re-materialization) + builtins, encodes, stores, and `await`s the **bounded** mpsc
   send — the ack means "accepted by the transport" (flow control, as grpc-go `SendMsg`).
   `send_message` after half-close = `Err` (invalid state), never a silent drop.
   `ResolveFailed` = the unary unresolved face; the stream stays open.

### IPC

9. **Command set** (`stream_*` prefix; `grpc_cancel` stays the one cancel entry point and
   looks up `in_flight` first, then the stream registry):

   | Command | In → Out | Note |
   |---|---|---|
   | `stream_open` | `draft, ctx, request_id, opts, on_event: Channel<StreamEventIpc>` → `Result<(), IpcError>` | resolves at `Opened` (return-at-Opened); `Err` = pre-Open fault |
   | `stream_send` | `request_id, body_template, ctx` → `Result<OutboundMessageIpc, IpcError>` | ack `{index, at_ms, size_bytes, preview, json}` with the **resolved** JSON; `Err` before `Opened` / after half-close |
   | `stream_half_close` | `request_id` → `()` | drops the outbound sender; starts the phase-2 timer |
   | `grpc_cancel` | `request_id` → `()` | existing |
   | `stream_message` | `request_id, index` → `String` | full pretty JSON on demand (> 64 KiB) |
   | `stream_release` | `request_id` → `()` | frees the store (rule 13) |
   | `stream_save_messages` | `request_id` → `Option<String>` | ticket 10 |
   | `stream_assemble` | `request_id, field_path` → `Option<AssembleResultIpc { path, written, total, size_bytes }>` | ticket 10 |

   `StreamEventIpc` is the tagged-union mirror of rule 5 (`Opened / Headers / Message /
   End / Fault`), typed by tauri-specta as `TAURI_CHANNEL<StreamEventIpc>`. Rejected:
   pending-until-end (research 05's recommendation — it assumed no task registry; with
   the core registry the return would only duplicate the channel); global Tauri events.
10. **Bindings regen** + TS fixtures for every new DTO; the gate for this feature is
    `pnpm lint` + full `pnpm test` + `cargo test --workspace`.

### Frontend

11. **`client.ts`** grows `streamOpen(draft, ctx, requestId, opts, onEvent)` (wraps `new
    Channel<StreamEventIpc>()`), `streamSend`, `streamHalfClose`, `streamMessage`,
    `streamRelease`, `streamSaveMessages`, `streamAssemble`; `grpcCancel` unchanged.
12. **State home**: a separate `streamStore` (`useSyncExternalStore`) keyed by
    `requestId` — `{ phase, headers, messages: MessageMeta[], end, cancelled,
    bytesFields, openedAt }`; only the response pane subscribes; channel events are
    batched per animation frame (ticket 09). `Step` gains `streamId: string | null`;
    `Step.outcome` / `InvokeOutcomeIpc` stay unary-only. Rejected: stream state inside
    `Step` (every batch re-renders everything subscribed to the workflow).
13. **Release rule** (one place): after every workflow-store transition, diff the set of
    `streamId`s held by any `Step` (draft or history snapshot) before/after; call
    `stream_release` for each id that disappeared (history step removed, workflow
    reset/closed, `streamId` replaced on an in-place re-Open). A focus-mode snapshot
    copies the `streamId`; the draft's next Open gets a fresh id. Core safety net: process
    exit. Rejected: explicit release calls at every deletion site.
14. **`Step.status`**: `"sending"` while the call is live (any phase); `End` OK → `"ok"`,
    non-OK → `"error"`; Cancel → new `"cancelled"` (unary keeps `"draft"` on cancel).
15. **Hook**: new `useStreamCall({ step, envName, onPatch, record, origin })` →
    `{ open, sendMessage, halfClose, cancel }`; shared helpers extracted from `useSend`
    (`draftOf(step)`, executed-snapshot, usage bump); `CallPanel` picks the hook by kind.
    Rejected: kind-switch inside `useSend`.

### Testing (graduates the "Fixture extension" fog)

16. **Core, no network**: `FakeTransport.stream_dynamic` with a scripted inbound
    `Vec<Result<Bytes, StreamEnd>>` + headers and captured outbound; `open_stream`
    events collected through the callback. Covers spine composition, auth-once, rule 6,
    both deadline phases, store indexing.
17. **IPC**: `stream_open_impl` takes a real `Channel<StreamEventIpc>`; tests build it with
    `Channel::new(|body| …)` (constructible without a webview, tauri 2.11.2
    `ipc/channel.rs:213`) and assert on the serialized events. No generic sink.
18. **Echo fixture** grows via `tonic::server::Grpc::{server_streaming, client_streaming,
    streaming}` + `DynamicCodec`: `ServerStream(Ping) → stream Pong` (`EchoConfig.
    stream_count`, `fail_after: Option<(k, code)>`), `ClientStream(stream Ping) →
    Pong { echoed: "count: N" }`, `Bidi(stream Ping) → stream Pong` (echo each),
    `Download(Ping) → stream Chunk { name, data: bytes }` for Assemble. The only place the
    real tonic bidi path (headers, trailers-only, RST on cancel) is exercised.
19. **Vitest**: fixtures for `StreamEventIpc` / `OutboundMessageIpc`; `streamStore` unit
    tests (batching, rule 13); `useStreamCall` with the two-shape `@/ipc/client` mock.

### Records

20. **ADR-0002** `docs/adr/0002-stream-call-lives-in-core.md` — stream call lifecycle in
    core behind `Sender`, IPC as adapter, one `Channel` per call (return-at-Opened).
21. **Glossary** (`crates/handshaker-core/CONTEXT.md`): **Stream store** lifetime
    refined — lives while any step (draft or history snapshot) references the call.

## Comments

**2026-09-24, constraints from [ticket 07](07-sending-model-and-phasing.md)**: the
outbound side is a channel-backed request stream fed by per-message IPC calls (Send
message resolves the body in core each time; Half-close ends the channel); messages must
be accepted before response headers arrive; auth/metadata materialized once at Open; the
deadline is two `tokio::time::timeout`s (activate; half-close to headers), not one over
the call.

**2026-09-24, input from [ticket 08](08-inbound-buffer-and-metadata-model.md)**: the
Stream store (per `request_id`, raw encoded inbound + outbound, freed on replace /
`stream_release` / channel drop); channel events `Headers` (initial metadata, streams
only), per-message `{index, at_ms, size_bytes, preview, json?}` with `json` inline only
when `size_bytes` ≤ 64 KiB, `End` (unary status shape minus body + totals); commands
`stream_message(request_id, index)` and `stream_release(request_id)`; the `Send message`
ack returns the same per-message fields plus the resolved JSON. Call client-streaming via
`Grpc::streaming()` (not `client_streaming()`, which merges trailers into headers).

**2026-09-26, input from [ticket 10](10-export-and-file-assembly.md)**: two more commands
over the Stream store — `stream_save_messages(request_id)` (all inbound as one JSON array →
Save-As) and `stream_assemble(request_id, field_path)` (decode each inbound message, write
the chosen `bytes` field through a sink → Save-As; returns path + "N of M" + size for the
toast). The `bytes`-field candidate list (non-repeated, top-level or nested single-message
paths) is computed in core from the output descriptor and must reach the frontend before
stream end so the toolbar menu can render. `save_bytes_via_dialog` needs a sink-taking
sibling (no `&[u8]` for multi-GB files).

**2026-09-28, amendment from [ticket 12](12-surfacing-the-kind.md)**: `stream_open`
takes the method kind the UI chose (`server | client | bidi`); core checks it against the
descriptor through one shared lookup (also used by `invoke_unary`) and refuses a
difference with `MethodKindMismatch { service, method, expected, actual }` as a pre-Open
`Err`; on agreement core picks `once(body)` (server) vs channel (client/bidi) itself.
`Opened` gains `kind` (`Opened { kind, auth_used, tls_used, bytes_fields }`); the
`streamStore` entry keeps it — it is the executed kind history panels route by, and pins
controls while the call is live.
