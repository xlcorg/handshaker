# Research: tonic 0.14 — dynamic streaming call facts (ticket 04)

Pinned versions (from `Cargo.lock`): **tonic 0.14.6**, tonic-types 0.14.6, prost 0.13.5,
prost-reflect 0.14.7, tokio-stream 0.1.18, tower 0.5.3, hyper 1.10.1, h2 0.4.14.
All source citations below are to the vendored crates under
`~/.cargo/registry/src/index.crates.io-*/<crate>-<ver>/` (abbreviated `tonic/…`, `hyper/…`,
`h2/…`), which match the pinned versions exactly. docs.rs for 0.14.6 was cross-checked for
the `Grpc` signatures.

Repo context: `crates/handshaker-core/src/grpc/transport/codec.rs` (`DynamicCodec`,
Encode = Decode = `prost_reflect::DynamicMessage`) and
`crates/handshaker-core/src/grpc/transport/tonic_impl.rs` (only `Grpc::unary` today).

## Answer

### 1. Signatures and the request side

All four entry points live on `tonic::client::Grpc<T>` and take the same `(Request<_>,
PathAndQuery, C)` triple; the codec is passed **by value, one per call**, and `encoder()` /
`decoder()` are each called exactly once inside `streaming` [E1]. `unary` and
`server_streaming` are literally `client_streaming` / `streaming` with the single message
wrapped in `tokio_stream::once(m)` [E1]:

```rust
pub async fn unary<M1, M2, C>(&mut self, request: Request<M1>, path: PathAndQuery, codec: C)
    -> Result<Response<M2>, Status>
pub async fn client_streaming<S, M1, M2, C>(&mut self, request: Request<S>, path: PathAndQuery, codec: C)
    -> Result<Response<M2>, Status>
pub async fn server_streaming<M1, M2, C>(&mut self, request: Request<M1>, path: PathAndQuery, codec: C)
    -> Result<Response<Streaming<M2>>, Status>
pub async fn streaming<S, M1, M2, C>(&mut self, request: Request<S>, path: PathAndQuery, codec: C)
    -> Result<Response<Streaming<M2>>, Status>
where
    T: GrpcService<Body>, T::ResponseBody: HttpBody + Send + 'static,
    <T::ResponseBody as HttpBody>::Error: Into<BoxError>,
    S: Stream<Item = M1> + Send + 'static,          // client_streaming / streaming only
    C: Codec<Encode = M1, Decode = M2>,
    M1: Send + Sync + 'static, M2: Send + Sync + 'static,
```

With `DynamicCodec`, `M1 = M2 = DynamicMessage`; the bounds are the same ones the existing
`unary` call already satisfies, so `DynamicCodec` needs **no change** for streaming. The
request stream yields plain `M1` (not `Result`) — tonic wraps it with `s.map(Ok)` before
handing it to `EncodeBody::new_client` [E1]. One-element stream: `tokio_stream::once(msg)`
(`pub fn once<T>(value: T) -> Once<T>`, "immediately ready and emits the provided value
once") [E2]. Push-style (user-driven) stream: `tokio::sync::mpsc::channel(n)` +
`tokio_stream::wrappers::ReceiverStream::new(rx)`; the stream ends when every `Sender` is
dropped (`poll_next` = `Receiver::poll_recv`) [E3].

**Half-close.** When the request stream returns `None`, `EncodedBytes::poll_next` returns
`Ready(None)` (after flushing any buffered bytes) and `EncodeBody::poll_frame` in the
`Role::Client` arm emits no trailers → body ends [E4]. hyper's `PipeToSendStream` then sees
`None` from the body and calls `send_eos_frame()` = `send_data(SendBuf::None, true)`, i.e. an
empty DATA frame with END_STREAM [E5] — exactly the spec's request EOS: "EOS (end-of-stream)
is indicated by the presence of the END_STREAM flag on the last received DATA frame" [E6].
So for client/bidi streaming, **ending the request `Stream` is the half-close**; there is no
separate API. An encode error from the codec surfaces as `Status::internal("Error encoding:
…")` on the body [E4], which hyper turns into a stream reset (`on_user_err` → `send_reset`)
[E5].

### 2. Initial metadata

`streaming` returns `Response::from_http(response)`, so `Response<Streaming<M2>>::metadata()`
is the HTTP response HEADERS block = gRPC *Response-Headers* [E1][E7]. The `streaming(..)`
future resolves when hyper's response future resolves, i.e. when the HEADERS frame arrives —
**before any message is read** (the body is still an unread `Streaming`) [E1][E8]. For
`client_streaming` (and therefore `unary`) tonic additionally **merges the trailers into the
same `MetadataMap`** (`parts.merge(trailers)`), and on the error path merges the headers into
`status.metadata_mut()` [E1] — that is why today's `metadata_to_map(response.metadata())`
in `tonic_impl.rs` shows headers and trailers mixed. The streaming variants do **not** merge:
headers are on `Response::metadata()`, trailers come separately (point 3).

*Trailers-Only*: if the HEADERS block itself carries `grpc-status`, `create_response` returns
`Err(status)` right away when the code is non-OK (before any `Streaming` exists), or builds
`Streaming::new_empty` when it is OK [E1]. The `Status` built by `Status::from_header_map`
carries every header other than `grpc-status`/`grpc-message`/`grpc-status-details-bin` as
`status.metadata()` [E9].

### 3. Trailers and final status

```rust
pub async fn message(&mut self) -> Result<Option<T>, Status>      // Streaming<T>
pub async fn trailers(&mut self) -> Result<Option<MetadataMap>, Status>
impl<T> Stream for Streaming<T> { type Item = Result<T, Status>; }
```

`message()` → `Ok(Some(m))` per message; `Ok(None)` when the body ended **and** the trailers
carried `grpc-status: 0`; `Err(Status)` when (a) the trailers carry a non-OK `grpc-status`,
(b) the transport/body errored, or (c) the stream ended without a `grpc-status` trailer —
HTTP 200 without trailer status maps to `Code::Unknown` "protocol error: missing grpc-status
trailer…", other HTTP codes map per `http-grpc-status-mapping.md` [E10][E11]. An `Err` is
yielded **once**; every later poll returns `Ready(None)` (`State::Error` is taken) [E10].

Trailers after `Err`: when the final status is non-OK, `StreamingInner::response()` does
`self.trailers.take()` before returning the error, so a subsequent `trailers().await` returns
`Ok(None)` [E10]. The trailer key/values are **not lost**: `Status::from_header_map` puts all
non-`grpc-*` trailers into `status.metadata()` [E9] — read them from the `Status`, exactly as
`tonic_impl.rs` does today for unary. After a clean `Ok(None)`, `trailers()` returns
`Ok(Some(MetadataMap))` (cached from the trailers frame) [E10]. Pitfall: calling `trailers()`
**before** draining the messages silently discards them (`while self.message().await?.is_some()
{}`) [E10].

`tonic-types`: `StatusExt::get_error_details_vec(&self) -> Vec<ErrorDetail>` decodes
`status.details()` [E12], and `details` is populated from the `grpc-status-details-bin`
trailer by the same `Status::from_header_map` used on both the unary and streaming paths
[E9][E10]. So the repo's `extract_status_details(&status)`
(`crates/handshaker-core/src/grpc/invoke/status_details.rs`) works unchanged on a streaming
`Err(Status)`.

### 4. Cancellation

tonic exposes **no explicit cancel** on `Grpc`, `Request`, `Response` or `Streaming` (no such
method in `client/grpc.rs`, `request.rs`, `codec/decode.rs`); cancellation is **drop-based**,
and the wire effect comes from hyper + h2:

- h2 sends an implicit `RST_STREAM` when the last handle to a still-open stream is dropped:
  `is_canceled_interest() = ref_count == 0 && !state.is_closed()` → `maybe_cancel` →
  `schedule_implicit_reset(stream, reason, …)`; for a **client** peer the reason is always
  `Reason::CANCEL` (the `NO_ERROR` branch is server-only) [E13].
- Before response headers arrive: dropping the `streaming(..)` future drops hyper's callback
  receiver; hyper's `SendWhen` notices (`poll_canceled`) and calls `ResponseFutMap::cancel()`,
  which tells the body-pipe task to `send_reset(h2::Reason::CANCEL)` ("so that a RST_STREAM is
  sent and flow-control capacity is freed") [E14].
- After headers: `Streaming<T>` owns hyper's `Incoming` → h2 `RecvStream` (one stream ref);
  the request-body pipe task owns the `SendStream` (another ref) until the request stream ends
  [E5][E14][E15]. Dropping `Streaming<T>` therefore resets the stream immediately for
  server-streaming (request already EOS'd, pipe finished) — this is what tonic's own example
  relies on: "stream is dropped here and the disconnect info is sent to server" [E16]. For
  **bidi with a still-open request stream, also end the request stream** (drop the mpsc
  `Sender`) or the send-side ref keeps the h2 stream alive until it does (see *Unconfirmed*).
- Spec: `CANCEL(8)` — "Mapped to call cancellation when sent by a client. Mapped to CANCELLED
  when sent by a server" [E6]; tonic maps an incoming `CANCEL` to `Code::Cancelled` [E11].

For Handshaker, `race_cancel_timeout` in `src-tauri/src/commands/grpc.rs` already cancels by
dropping the work future; a streaming adapter must make sure that drop also drops the
`Streaming<T>` handle and closes the request stream.

### 5. Deadline

```rust
pub fn set_timeout(&mut self, deadline: Duration)   // tonic::Request<T>
```

Inserts `grpc-timeout` with the most precise unit that fits in 8 digits (`30 s` →
`"30000000u"`) [E17], matching the spec grammar `Timeout → "grpc-timeout" TimeoutValue
TimeoutUnit`, value "at most 8 digits" [E6]. Server-side, a gRPC server cancels the call once
the deadline passes and the client "will give up and fail the RPC with the DEADLINE_EXCEEDED
status" [E18]; with a spec-following server that arrives as `grpc-status: 4` in the trailers →
`message()` returns `Err(Status { code: DeadlineExceeded })` [E10].

Client-side, tonic's `Channel` stack includes a `GrpcTimeout` layer that **parses the
request's own `grpc-timeout` header**, takes the shorter of it and `Endpoint::timeout`, and
races the **`call` future only** — i.e. up to response headers — against a `tokio::time::sleep`
[E19][E20]. When that fires, the error is `TimeoutExpired`, which `find_status_in_source_chain`
maps to **`Status::cancelled("Timeout expired")`, not `DeadlineExceeded`** [E11]. After
headers, **nothing on the client bounds the message stream**; only the server's deadline
does. Two consequences for a streaming adapter: (a) a "deadline" observed locally before
headers is `Cancelled`/"Timeout expired", one observed from the server is `DeadlineExceeded`
— map both; (b) if Handshaker wants a hard local cap on a whole streaming call it must keep
its own `tokio::time::timeout` (as `race_cancel_timeout` does today) — `set_timeout` alone
will not end an open stream locally. `Endpoint::timeout` explicitly does *not* set the header
[E21].

### 6. Message-size limits in streams

Yes, both are **per message**. `max_decoding_message_size` is threaded into
`Streaming::new_response(.., max_message_size)`; `decode_chunk` compares each frame's 4-byte
length prefix against the limit (`DEFAULT_MAX_RECV_MESSAGE_SIZE = 4 MiB` when unset) and
returns `Status::out_of_range("Error, decoded message length too large: found N bytes, the
limit is: L bytes")`; for compressed frames the decompressed size is capped too
(`ResourceExhausted`) [E10][E22]. `max_encoding_message_size` goes into
`EncodeBody::new_client(.., max_message_size)` and `finish_encoding` checks each encoded item
(`DEFAULT_MAX_SEND_MESSAGE_SIZE = usize::MAX`) → `Status::out_of_range` [E4][E22]. The repo's
`CallOptions.max_message_bytes` (0 → `usize::MAX` at the IPC boundary) applies unchanged.
Note: a decode-size `Err` is returned straight from `poll_next` **without** entering
`State::Error`, so the read buffer is left mid-frame — treat any `Err` from `message()` as
terminal and drop the stream [E10].

### 7. `Grpc::ready()` and sharing a `Channel`

`ready()` is `poll_fn(|cx| inner.poll_ready(cx))` [E1]; on `Channel` that is
`tower::buffer::Buffer::poll_ready`, which reserves one mpsc permit toward the background
worker [E23][E24]. The tower contract is one `call` per successful `poll_ready`; calling
`call` on a `Buffer` that has not reserved a permit **panics** in
`PollSender::send_item` ("`send_item` called without first calling `poll_reserve`") [E25] —
hence keep the existing pattern of `ready().await` immediately before each `unary`/
`streaming` call on a fresh `Grpc::new(channel.clone())`. `Channel` is `Clone` and cloning is
"cheap … and encouraged"; a single `Channel` value can only have one request in flight because
`call` takes `&mut self` [E23]. Every clone shares **one** h2 connection (`Reconnect` over one
hyper `SendRequest`; default buffer 1024) [E26][E23]; concurrent streams are multiplexed on it
and bounded by the server's `max_concurrent_streams` and the connection window — a known
throughput ceiling that people work around with several channels [E27]. The `Buffer` worker
only forwards the `call` future to the caller, so a long-lived `Streaming<T>` does not block
other calls; `Streaming<T>` is `Send + Sync + Unpin + 'static` and can be moved into a spawned
task after `Grpc` is dropped [E10]. With `connect_lazy`, `Reconnect::poll_ready` swallows the
connect error (`is_lazy`) and `ready()` returns `Ok`; the failure surfaces from `call` as
`Status::unavailable` [E28] — the repo's
`unary_dynamic_returns_unavailable_outcome_on_dead_channel` test already depends on this.

## Evidence

- [E1] `tonic/src/client/grpc.rs` — `ready`, `unary`, `client_streaming`, `server_streaming`,
  `streaming`, `create_response` (Trailers-Only handling, `Streaming::new_response` /
  `new_empty`, `Response::from_http`); `client_streaming` merges trailers into `parts` and
  headers into the error `Status`. Cross-checked: <https://docs.rs/tonic/0.14.6/tonic/client/struct.Grpc.html>.
- [E2] `tokio-stream/src/once.rs` — `pub fn once<T>(value: T) -> Once<T>`.
- [E3] `tokio-stream/src/wrappers/mpsc_bounded.rs` — `ReceiverStream::new`, `poll_next` =
  `Receiver::poll_recv`.
- [E4] `tonic/src/codec/encode.rs` — `EncodedBytes::poll_next` (`Ready(None)` when the
  source ends), `EncodeBody::new_client`, `EncodeState::trailers` (`Role::Client => None`),
  `encode_item`/`finish_encoding` (per-item size check, `DEFAULT_MAX_SEND_MESSAGE_SIZE`).
- [E5] `hyper/src/proto/h2/mod.rs` lines 185–266 — `PipeToSendStream`: `None` →
  `send_eos_frame()` → `send_data(SendBuf::None, true)`; `on_user_err` → `send_reset`.
- [E6] gRPC over HTTP/2 spec, <https://github.com/grpc/grpc/blob/master/doc/PROTOCOL-HTTP2.md>:
  Timeout grammar and "at most 8 digits"; request EOS = END_STREAM on the last DATA frame;
  `Response → (Response-Headers *Length-Prefixed-Message Trailers) / Trailers-Only`; "Status
  must be sent in Trailers even if the status code is OK"; RST_STREAM mapping table incl.
  `CANCEL(8)`.
- [E7] `tonic/src/response.rs` — `metadata()`, `into_parts()`, `from_parts()`.
- [E8] `hyper/src/proto/h2/client.rs` lines 606–656 — `ResponseFutMap::poll` resolves on the
  h2 response (headers) and wraps the body as `IncomingBody::h2(stream, ..)`.
- [E9] `tonic/src/status.rs` lines 466–500 — `Status::from_header_map`: `grpc-status`,
  percent-decoded `grpc-message`, base64 `grpc-status-details-bin` → `details`, remaining
  headers → metadata.
- [E10] `tonic/src/codec/decode.rs` — `Streaming::message`, `trailers` (drains messages;
  cached trailers), `StreamingInner::response` (`trailers.take()` on non-OK), `poll_next`
  (`State::Error` yielded once), `decode_chunk` (per-message length check vs
  `DEFAULT_MAX_RECV_MESSAGE_SIZE`, decompression cap), `assert_impl_all!(Streaming<()>: Send,
  Sync)`, `impl<T> Unpin for Streaming<T>`.
- [E11] `tonic/src/status.rs` — `code_from_h2` (`CANCEL => Code::Cancelled`, lines ~400–411);
  `find_status_in_source_chain` (`TimeoutExpired => Status::cancelled`, line 644);
  `infer_grpc_status` (lines 777–841: missing trailer on HTTP 200 → `Unknown`, HTTP code map).
- [E12] `tonic-types/src/richer_error/mod.rs` — `StatusExt::get_error_details_vec` and its
  impl `pb::Status::decode(self.details())` (lines 258, 622–624).
- [E13] `h2/src/proto/streams/streams.rs` lines 1524–1605 — `impl Drop for OpaqueStreamRef`,
  `drop_stream_ref`, `maybe_cancel` (`Reason::CANCEL` unless server-side early response);
  `h2/src/proto/streams/stream.rs` line 270 — `is_canceled_interest`.
- [E14] `hyper/src/client/dispatch.rs` lines 347–386 — `SendWhen::poll` → `poll_canceled` →
  `when.cancel()`; `hyper/src/proto/h2/client.rs` lines 458–516, 526–604 — `PipeMap` resets
  with `h2::Reason::CANCEL` on cancel; `ResponseFutMap::cancel`.
- [E15] `h2/src/client.rs` line 238 (`ResponseFuture { inner: OpaqueStreamRef }`),
  `h2/src/share.rs` lines 97–140 (`SendStream`/`RecvStream` hold stream refs; `RecvStream`'s
  `Drop` only clears the receive buffer, lines 480–489).
- [E16] tonic streaming example, `examples/src/streaming/client.rs` (master; the `v0.14.6`
  tag path returned 404): `stream.take(num)` then "stream is dropped here and the disconnect
  info is sent to server"; bidi uses `tokio_stream::iter(..).take(n)` / `.throttle(dur)` as
  the request stream.
- [E17] `tonic/src/request.rs` lines 266–297, 397–420 — `set_timeout`, `duration_to_grpc_timeout`.
- [E18] gRPC deadlines guide, <https://grpc.io/docs/guides/deadlines/>: client fails the RPC
  with `DEADLINE_EXCEEDED`; server auto-cancels once the deadline passed.
- [E19] `tonic/src/transport/service/grpc_timeout.rs` — parses the request's `grpc-timeout`,
  `min` with the configured timeout, wraps only `inner.call(req)`; expiry →
  `TimeoutExpired`.
- [E20] `tonic/src/transport/channel/service/connection.rs` line 73 — client stack includes
  `GrpcTimeout::new(s, endpoint.timeout)`.
- [E21] `tonic/src/transport/channel/endpoint.rs` lines 238–246 — `Endpoint::timeout` "does
  **not** set the timeout metadata (`grpc-timeout` header)".
- [E22] `tonic/src/codec/mod.rs` lines 101–102 — `DEFAULT_MAX_RECV_MESSAGE_SIZE = 4 MiB`,
  `DEFAULT_MAX_SEND_MESSAGE_SIZE = usize::MAX`.
- [E23] `tonic/src/transport/channel/mod.rs` lines 43–69, 208–222 — "Multiplexing requests"
  doc, `Channel { svc: Buffer<..> }`, `DEFAULT_BUFFER_SIZE = 1024`, `poll_ready`/`call`.
- [E24] `tower/src/buffer/service.rs` lines 97–130 — `poll_ready` = `tx.poll_reserve`,
  `call` = `tx.send_item`.
- [E25] `tokio-util/src/sync/mpsc.rs` lines 171–192 — `PollSender::send_item` panics without
  a prior successful `poll_reserve`.
- [E26] `tonic/src/transport/channel/service/connection.rs` — one hyper
  `client::conn::http2::SendRequest` behind `Reconnect`, wrapped by the tower stack.
- [E27] tonic issue #607 "Achieving better throughput with tonic clients",
  <https://github.com/hyperium/tonic/issues/607> — one channel ≈ 30k QPS, five channels ≈
  170k QPS.
- [E28] `tonic/src/transport/channel/service/reconnect.rs` — `poll_ready` stores the connect
  error when `has_been_connected || is_lazy` and returns `Ok`; `tonic/src/status.rs` line
  653 maps `ConnectError` → `Status::unavailable`.

## Unconfirmed

- **Bidi drop timing.** From source reading, dropping `Streaming<T>` while the request
  stream is still open leaves the h2 stream's `ref_count > 0` (the pipe task holds the
  `SendStream`), so no `RST_STREAM` is sent until the request stream also ends [E13][E15].
  Not verified on the wire; a live test with a packet capture or an h2 trace log is needed
  before relying on "drop response = cancel" for bidi.
- **What tonic sends when the server-side deadline fires.** Only the client-side mapping
  (`TimeoutExpired` → `Cancelled`) was verified; the exact `grpc-status` a tonic server emits
  when its own `GrpcTimeout` layer expires was not traced. Non-tonic servers are expected to
  send `DEADLINE_EXCEEDED` per [E18].
- **Read-buffer state after a size-limit `Err`.** The claim that the stream is left mid-frame
  (no `State::Error`) is from reading `decode_chunk`/`poll_next` [E10]; not exercised by a test.
- The `v0.14.6` tag path for `examples/src/streaming/client.rs` returned 404; the master copy
  was used [E16]. The relevant behaviour (drop → disconnect) does not depend on the tag.
