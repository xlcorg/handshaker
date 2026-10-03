# tonic 0.14: dynamic streaming call facts

Type: research
Status: resolved
Blocked by: —
Map: ../map.md

## Question

What does `tonic::client::Grpc` (tonic 0.14, prost 0.13, prost-reflect 0.14 — pinned in
the workspace `Cargo.toml`) offer for **dynamic** (custom-codec) streaming calls, with
exact signatures and behaviours:

1. `Grpc::server_streaming`, `client_streaming`, `streaming` — signatures with a custom
   `Codec` (the repo's `DynamicCodec`, `crates/handshaker-core/src/grpc/transport/codec.rs`);
   what the request side needs for client/bidi (a `Stream` of messages; how to build a
   one-element stream and half-close).
2. **Initial metadata**: where headers are available on a streaming response
   (`Response<Streaming<T>>::metadata()`), and when they arrive relative to the first
   message.
3. **Trailers and final status**: `Streaming::trailers()`, how the end of stream and a
   non-OK status surface (`message()` returning `Err(Status)` vs `Ok(None)`), and whether
   `tonic-types` rich error details still work on a streaming status.
4. **Cancellation**: what dropping the `Streaming` / the request future does on the wire
   (RST_STREAM?), and whether tonic exposes an explicit cancel.
5. **Deadline**: how a per-call deadline is set for streaming (`Request::set_timeout` →
   `grpc-timeout` header) and how a deadline expiry surfaces.
6. Max message size settings (`max_decoding_message_size`) still apply per message?
7. Any known pitfalls with `Grpc::ready()` and reusing a channel across concurrent calls.

Primary sources: tonic 0.14 source/docs.rs, tonic examples (streaming), grpc-core spec for
half-close semantics. Cite versions.

Findings file: `docs/archive/2026-10-04-streaming-rpcs/research/tonic-dynamic-streaming.md` on branch
`research/tonic-dynamic-streaming`.

## Answer

Resolved 2026-09-24 by a research subagent against vendored sources (tonic 0.14.6 /
hyper 1.10.1 / h2 0.4.14). Full findings with citations:
[tonic-dynamic-streaming.md](../research/tonic-dynamic-streaming.md) (also committed on
branch `research/tonic-dynamic-streaming`).

1. **Signatures** — `server_streaming(Request<M1>, PathAndQuery, C) ->
   Result<Response<Streaming<M2>>, Status>`; `client_streaming` / `streaming` take
   `Request<S>` with `S: Stream<Item = M1> + Send + 'static`. Same codec bounds the
   current `unary` meets → **`DynamicCodec` needs no change**. `unary` / `server_streaming`
   are `tokio_stream::once(m)` over the streaming variants. **Half-close = the request
   `Stream` ending** (hyper sends empty DATA + END_STREAM). Push-style input:
   `mpsc::channel` + `ReceiverStream` (ends when all senders drop).
2. **Initial metadata** — `Response<Streaming<T>>::metadata()` = response HEADERS,
   available when the call future resolves, before any message. Only `unary` /
   `client_streaming` merge trailers into that map; streaming variants keep them
   separate. Trailers-Only with non-OK status → `Err(Status)` from the call itself.
3. **End / status** — `message()`: `Ok(Some)` / `Ok(None)` (clean end, `grpc-status: 0`)
   / `Err(Status)` (non-OK trailer, transport error, or missing grpc-status → `Unknown`);
   the `Err` is yielded once. After a non-OK status `trailers()` returns `Ok(None)` — the
   trailer pairs live in `status.metadata()`. `get_error_details_vec` works unchanged.
   Calling `trailers()` early drains and drops messages.
4. **Cancellation** — no explicit API. Dropping the call future before headers →
   `RST_STREAM(CANCEL)`; dropping `Streaming<T>` after headers releases the recv ref and
   h2 resets with `CANCEL` when the last ref drops. For bidi the request-body pipe also
   holds a ref → close the request stream too.
5. **Deadline** — `Request::set_timeout(Duration)` → `grpc-timeout` header. tonic's
   client-side `GrpcTimeout` layer only bounds the call-to-headers phase and maps expiry
   to `Status::cancelled("Timeout expired")`, not `DeadlineExceeded`; after headers only
   the server's deadline applies (arrives as `DeadlineExceeded` in trailers). **A
   whole-call local cap still needs Handshaker's own `tokio::time::timeout`.**
6. **Size limits** are per message (default 4 MiB recv, `usize::MAX` send; violation →
   `OutOfRange`). Treat any `Err` as terminal (a decode-size error leaves the buffer
   mid-frame).
7. **`ready()`** reserves a Buffer permit; `call` without it panics → keep `ready().await`
   before each call on a fresh `Grpc::new(channel.clone())`. All clones share one h2
   connection (multiplexed). `connect_lazy` + `Reconnect` makes `ready()` succeed and
   surfaces connect failures from `call` as `Unavailable` (existing test relies on this).

Unconfirmed: bidi reset timing when only the response half is dropped; exact status a
tonic *server* emits on its own deadline expiry; buffer state after a size-limit error.
