# Deadline and cancel semantics for a stream call

Type: grilling
Status: resolved
Blocked by: 01
Map: ../map.md

## Question

Given Postman's behaviour (ticket 01) and the repo's "Request deadline" pref (timeout over
the whole Send in `race_cancel_timeout`):

- Does the deadline apply to a stream call, and as what (whole-call gRPC deadline / idle
  timeout / not at all, with an explicit "∞" affordance)?
- On user Cancel mid-stream: are received inbound messages kept, and how is the terminal
  state presented (neutral "cancelled · N messages" vs gRPC `CANCELLED` error face)?
- On deadline expiry mid-stream: same question.

Resolution = the rule the spec states, plus the glossary wording if "cancel" needs a term.

## Answer

Resolved 2026-09-24 (grilling, two rounds). Rules the spec states:

1. **Deadline bounds stream start only.** The single "Request deadline" pref
   (`requestTimeoutMs`, default 30 s, min 1 s — no `0 = ∞` needed) applies to a stream
   call as a timer over the phase *Send → initial metadata received* (activate + call
   until the server accepts the call, i.e. tonic's `Response::metadata()` is available).
   After stream start the call has **no deadline**: it lives until stream end or Cancel.
   Expiry before stream start = the same `DeadlineExceeded` / "Request timed out" face as
   unary. Mid-stream expiry cannot happen by construction. Rejected: Postman's whole-call
   deadline (kills subscriptions under a 30 s default), a second "stream deadline" pref,
   an idle/between-message timeout.
2. **No `grpc-timeout` on stream calls.** The unary path sets none today either (only the
   IPC-side `tokio::timeout`). A `grpc-timeout` header makes the *server* cancel the RPC at
   the deadline (whole-RPC semantics, research 04 [E18]), so the stream-start bound is
   Handshaker's own `tokio::time::timeout` around "call → headers", not `set_timeout`.
   Constraint carried into ticket 11 (transport shape).
3. **Cancel keeps received messages.** Cancel is a **client-side terminal state**,
   distinct from stream end: no server status exists (tonic drop → RST_STREAM), so no
   gRPC code is synthesized. The status strip shows a neutral "Cancelled" (no `1
   CANCELLED`, no error face over the messages), trailers empty, total elapsed frozen at
   the cancel instant. How the zero-messages case renders (face vs strip) is decided by
   the pane prototype (ticket 09). Rejected: Postman's synthesized `1 CANCELLED` status
   (a server status the server never sent), discarding messages.
4. **Pref hint wording** (`src/lib/messages.ts` `requestDeadlineHint`) changes to:
   "Per-request deadline. Bounds a unary call end-to-end and a streaming call until the
   server accepts it; an open stream has no deadline." Pref name unchanged; unary
   behaviour unchanged.
5. **Glossary**: **Cancel (отмена)** added to `crates/handshaker-core/CONTEXT.md` (Вызов).
   Whether "Stream start" earns a term stays with ticket 08.

## Comments

**2026-09-24, amended by [ticket 07](07-sending-model-and-phasing.md), point 6.** Rule 1
("deadline bounds Send to initial metadata") holds for unary and server-streaming only.
A client-streaming server sends its response headers after the handler returns (tonic
0.14.6 `src/server/grpc.rs:303-327`), so for client/bidi the deadline bounds two phases:
Open to transport connected, and Half-close to stream start. An open stream between them
has no deadline. Rules 2-5 unchanged. Pref hint wording (rule 4) becomes: "Per-request
deadline. Bounds connecting, and how long the server may take to answer once the client
has finished sending; an open stream has no deadline."
