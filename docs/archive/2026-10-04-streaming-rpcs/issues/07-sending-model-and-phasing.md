# Sending model for client/bidi and delivery phasing

Type: grilling
Status: resolved
Blocked by: 02
Map: ../map.md

## Question

The usage model is read-oriented (see map Notes). Given Postman's sending model (ticket
02), decide:

- Client/bidi: **one outbound message + immediate half-close** (current `body_template`
  is the message; `SavedRequest`/`Step` unchanged) vs **interactive** multi-message
  sending (stream stays open, per-message Send, explicit Half-close control) vs both.
- If interactive is deferred: fog or out of scope?
- Phasing: ship server-streaming first, or all three kinds in one release?

Resolution = the sending model the spec commits to and what it implies for the request
side data model.

## Answer

Resolved 2026-09-24 (grilling, three rounds). Rules the spec states:

1. **Interactive sending for client-streaming and bidi** (Postman's model). One body
   editor; while the stream is open, **Send message** emits the current body as one
   outbound message per click (edit between clicks); **Half-close** is a separate control
   that ends the outbound side; Cancel aborts as decided in ticket 06. Rejected: one-shot
   (one message + immediate half-close: a read-oriented bidi subscription must be able
   to keep its outbound side open, and one-shot is just Open, Send message, Half-close);
   both modes behind a switch (two paths for one thing).
2. **Open sends nothing** (Postman's Invoke). For client/bidi the primary action **opens**
   the stream call: resolve, auth, activate, metadata on the wire, no outbound message.
   The first message is an explicit Send message. Rejected: opening with the body as the
   first message (one click for subscriptions); the user prefers the Postman step. For
   unary and server-streaming the existing Send = Open + the single outbound message +
   half-close in one step; nothing changes for them.
3. **All three kinds ship in one release.** Transport, timeline and IPC shape are shared;
   only the two extra controls differ. No server-streaming-first phase.
4. **A saved request persists one body** (`body_template`); `SavedRequest` /
   `Step.requestJson` unchanged. Sent messages live in the call's timeline (tickets 08/09),
   not in the request. A persisted message list, if ever, is a separate entity, not this
   effort. The user's "assemble chunks into one message" need is the **inbound** case:
   ticket 10 (bytes field over N inbound messages to one file); no outbound batch or
   chunked sending is wanted.
5. **Resolve per message, auth once.** Every Send message runs the current body through
   resolve and builtins with the env at that moment (`{{$guid}}` fresh per message).
   Auth and metadata are materialized once at Open (they are on the wire once, in the
   initial metadata); an env switch mid-stream does not affect them.
6. **Deadline generalized** (amends ticket 06, see its Comments). The one "Request
   deadline" pref bounds two phases of every call: **Open to transport connected**
   (activate) and **Half-close to stream start** (initial metadata received). Between them
   an open stream has no deadline. For unary and server-streaming half-close is immediate,
   so this reduces exactly to ticket 06's rule (Send to initial metadata). For client/bidi
   the second timer starts when the user clicks Half-close. Motivation (verified in tonic
   0.14.6 `src/server/grpc.rs:303-327`): a client-streaming server sends response headers
   only after its handler returns, i.e. after the client's half-close; bidi handlers often
   await the first inbound message before returning. "Send to initial metadata" would
   therefore kill any interactive client-streaming session longer than the deadline.
7. **Consequences carried to other tickets**: outbound messages must be sendable before
   headers arrive (channel-backed request stream; constraint for ticket 11); "stream
   start" is a late or absent phase for client/bidi (input to ticket 08's glossary
   question); the controls Open / Send message / Half-close / Cancel and their labels are
   decided by the pane prototype (ticket 09).
8. **Assumptions stated, not questioned**: Half-close with zero messages sent is allowed
   (legal gRPC); an invalid body blocks Send message exactly as it blocks unary Send, the
   stream stays open.
9. **Glossary**: **Open (открытие)** added to `crates/handshaker-core/CONTEXT.md` (Вызов).
