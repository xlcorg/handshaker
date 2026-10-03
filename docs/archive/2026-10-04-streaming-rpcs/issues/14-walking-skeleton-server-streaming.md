# 14: Walking skeleton — server-streaming end to end

**What to build:** Pressing Send on a server-streaming method opens a **Stream call**:
messages appear in the Messages tab as they arrive — a flat timeline, newest first, each
row `←` arrow · `#index` · one-line preview · size · local `HH:MM:SS.mmm` — and a footer
statusline shows `● STREAMING · N msgs · bytes · elapsed` (ticking), then `● OK` /
`● <code> <NAME>` at **Stream end** or `○ Cancelled` (elapsed frozen) after **Cancel**;
received rows stay in every terminal state. Send morphs into Cancel while the call is live
(existing busy delay). This ticket threads the whole path per ADR-0002: core owns the call
(`open_stream` sharing resolve → builtins → auth → activate with unary `send`; a
`StreamCall` actor handle in a core `StreamRegistry`; the **Stream store** of raw encoded
inbound messages; events `Opened { kind, auth_used, tls_used } → Headers → Message { index,
at_ms, size_bytes, preview, json? } → End | Fault`; phase-1 deadline around activate; token
invalidation on status 16), one transport method `stream_dynamic` over a raw-bytes codec
(always tonic `streaming()`), IPC `stream_open` (takes the UI's kind; resolves at `Opened`;
one `Channel` per call), `stream_release`, and `grpc_cancel` looking up the unary registry
then the stream registry. Frontend: a separate `streamStore` keyed by request id with
per-frame event batching, `Step.streamId`, `Step.status "cancelled"`, the one-place release
rule (diff of referenced stream ids → `stream_release`), `useStreamCall { open, cancel }`,
and the call panel picking the hook by the kind from ticket 13. No expand, no
Headers/Trailers tabs, no search yet. Unary is untouched.

**Blocked by:** 13 (Method kind derived live)

**Status:** resolved

- [x] Against the echo fixture's new `ServerStream(Ping) → stream Pong` (configurable count), Send shows N rows newest-first and the footer ends `● OK` with elapsed and totals
- [x] Cancel mid-stream keeps received rows, shows `○ Cancelled`, freezes elapsed, synthesizes no gRPC status, sends RST on the wire; `Step.status` becomes `"cancelled"`
- [x] A non-OK stream end is an `End` event with that code; trailers-only non-OK = `End` with zero messages; rows stay
- [x] Deadline: expiry before stream start (activate phase) yields the unary `DeadlineExceeded` face; an open stream has no deadline; no `grpc-timeout` header is sent
- [x] `End.status_code == 16` invalidates the cached OAuth token; Cancel never does
- [x] Per-message event carries `index` (from 1), `at_ms`, `size_bytes`, `preview` (≤ ~200 chars compact JSON), and `json` inline only when `size_bytes` ≤ 64 KiB (else `null`)
- [x] Stream store keeps raw encoded bytes; freed on re-Send of the same step, on step removal / workflow close via the release rule, on channel drop
- [x] `stream_open` returns `Ok` at `Opened` and `Err` only for pre-Open faults; later outcomes arrive on the channel only; the IPC race handles cancel, not timeout
- [x] `grpc_cancel` cancels a stream call through the registry; unary cancel unchanged
- [x] Core tests over a scripted `FakeTransport::stream_dynamic`: spine composition, event order, store indexing, phase-1 deadline, rule 16
- [x] IPC test builds a real `Channel::new(|body| …)` and asserts the serialized `StreamEventIpc` sequence; `from_core_error` exhaustive mapping updated
- [x] Bindings regenerated; TS fixtures for `StreamEventIpc`; `streamStore` tests (batching, release diff); `useStreamCall` with the two-shape `@/ipc/client` mock
- [x] ADR-0002 and glossary terms referenced, not restated; strings of touched files in the messages module
- [x] Gate green: `pnpm lint` + `pnpm test` + `cargo test --workspace`

## Comments

**2026-09-28 — resolved.** Commits on `claude/streaming-rpcs`: `a8231fa` (core), `0e6ab9b` (IPC),
`5dd5bea` (frontend), `b0ad54d` (review fixes). Split into core+IPC → frontend inside the ticket.

- **Core** (`crates/handshaker-core/src/stream.rs`, new): `MethodKind`, `StreamEvent` /
  `StreamEvents` callback, `StreamCall` actor handle (abort on drop), `StreamRegistry`
  (`insert` replaces + frees, `release`, `release_call` ptr-eq), Stream store of raw encoded
  inbound bytes, `PREVIEW_CHARS = 200`, `INLINE_JSON_MAX_BYTES = 64 KiB`. `Sender::prepare()` is
  the shared spine prefix (resolve → builtins → auth → activate) used by `send` and
  `open_stream`; `invalidate_on_unauthenticated` is the single rule-16 helper. Transport:
  `RawCodec` (identity `Bytes`), `GrpcTransport::stream_dynamic(channel, path, outbound, metadata,
  opts) → StreamStart { headers, inbound }` — always `Grpc::streaming()`, no `grpc-timeout`;
  trailers-only → `StreamStart` with empty headers ending at once. `CallOptions.phase_timeout`
  bounds activate (pre-Open `Err(DeadlineExceeded)`) and half-close → stream start (`Fault`
  after `Opened`); unary ignores it. `FakeTransport::stream_dynamic` is scripted
  (`StreamScript`) behind the `test-support` feature; echo fixture gains `ServerStream(Ping) →
  stream Pong` with `EchoConfig { stream_count, fail_after, stream_delay, seen_metadata }`.
- **IPC** (`src-tauri/src/ipc/stream.rs`, `commands/grpc.rs`): `StreamEventIpc` tagged union
  (`type: Opened | Headers | Message | End | Fault`), `MethodKindIpc`; `stream_open` resolves at
  `Opened`, `Err` only pre-Open, races cancel only (`race_cancel_handoff` registers the call
  into `state.streams` under the `in_flight` lock — no lost-cancel window); dead channel →
  call cancelled + released (safety net); `stream_release`; `grpc_cancel` = unary registry
  then stream registry. `from_core_error` 17 → 18 (`DeadlineExceeded`).
- **Frontend** (`src/features/stream/`): `streamStore` (per-rAF batching, terminal events flush
  synchronously; one local elapsed clock frozen at End/Fault/Cancel), `installStreamReleaseRule`
  (the ONE release place — subscribes to `workflowStore`, diffs referenced `streamId`s →
  `streamStore.drop` + `streamRelease`; installed in `WorkflowApp`), `useStreamCall({ step,
  envName, kind, onPatch, record, origin }) → { open, cancel }`, `StreamView` / `Timeline` /
  `StreamFooter`. `Step.streamId`, `StepStatus += "cancelled"`; `Step.outcome` stays unary-only.
  `CallPanel` picks `useStreamCall` for `kind === "server"`, otherwise `useSend`; a `Fault`
  renders the existing client-error face. `faultFromIpcError` extracted into
  `workflow/netDiagnostics.ts` (shared by `sendStep`, `useSend`, `useStreamCall`).
- **Gate**: `cargo test --workspace` 412 passed; `pnpm lint` clean; `pnpm test` 179 files /
  1354 tests. Bindings regenerated (prettier-formatted, zero diff on regen).
- **Review**: no standards violations after fixes. Accepted: Headers/Trailers tabs already
  visible (empty) — ticket 15 fills them; `stepView.ts` strings centralized while touched.
  Noted for later: client/bidi/unary kinds in `open_stream` → `NotImplemented` until 16;
  `Opened.kind` echoes the UI kind until 17's descriptor gate; `bytes_fields` always `[]`
  until 18; history re-send of a stream snapshot still routes unary until 19.
