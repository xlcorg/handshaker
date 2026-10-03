# Postman: streaming call lifecycle (deadline, cancel, retained state)

Type: research
Status: resolved
Blocked by: —
Map: ../map.md

## Question

How does Postman's gRPC client treat the lifecycle of a streaming call, so Handshaker can
mirror it:

1. **Deadline / timeout** — does the request-level deadline (Postman "timeout" setting)
   apply to streaming calls? If so, is it a whole-call gRPC deadline, an idle timeout
   between messages, or not applied at all?
2. **Cancel / end by the user** — what happens to messages already received when the user
   cancels (or ends) a streaming call: kept and shown, or discarded? How is the terminal
   state shown (neutral "cancelled", gRPC `CANCELLED` status, error face)?
3. **Server-side end** — how the final status + trailers are shown relative to the
   received messages (same list? separate strip?).

Primary sources: learning.postman.com gRPC docs (streaming methods, cancel, settings),
Postman release notes / GitHub issues on postman-app-support if docs are silent.

Findings file: `docs/archive/2026-10-04-streaming-rpcs/research/postman-stream-lifecycle.md` on branch
`research/postman-stream-lifecycle`.

## Answer

Resolved 2026-09-24 by a research subagent. Full findings with citations:
[postman-stream-lifecycle.md](../research/postman-stream-lifecycle.md) (also committed on
branch `research/postman-stream-lifecycle`).

1. **Deadline** — Postman has a single knob, *Settings → Connection Timeout* ("deadline to
   invoke and receive the response, in ms; 0 = keep the connection open indefinitely").
   Staff call it "the connection deadline" and map it to `grpc-timeout`; default is
   infinite. So it is a **whole-call gRPC deadline that also bounds streams**; there is
   no idle/between-message timeout. (Postman never says "applies to streaming" verbatim —
   inferred from the wording and gRPC semantics.)
2. **Cancel / End** — two controls: *End Streaming* (client/bidi half-close; the call then
   finishes with the server's status) and *Cancel* (abort). **Received messages are
   kept**; the cancel is appended as the newest timeline row ("Call cancelled"). The
   terminal state is the **gRPC `CANCELLED` status in the normal status slot** (`1
   CANCELED — "You have cancelled the execution of the method."`, trailers area: "No
   trailer received"), not a neutral badge.
3. **Server end** — messages live in one timeline (sent / received / *informative* rows,
   newest first); **status code + time, metadata and trailers are separate strips**. The
   end is echoed into the timeline as an informative row ("Call completed"); status
   wording is `<code> <NAME>` (`0 OK`).

Unconfirmed: an explicit Postman statement on streams + deadline; the timeout default
after Aug 2024; exact terminal-row wording (two variants seen).
