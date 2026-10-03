# Postman: sending model for client-streaming and bidi

Type: research
Status: resolved
Blocked by: —
Map: ../map.md

## Question

For client-streaming and bidi methods, how does Postman let the user send messages, so
Handshaker can mirror it:

1. Is sending **interactive** (stream stays open; user edits the body and sends message by
   message; explicit "End streaming" / half-close control) or **batch** (author N messages
   up front, one Send)? Or both?
2. What does a **saved request** for a streaming method persist — one message body, a
   list of messages, or a script?
3. Did Postman ship all kinds (server / client / bidi) together, or server-streaming first?
   (Informs whether Handshaker phases the delivery.)
4. Any UI differences between server-streaming and bidi response areas worth noting.

Primary sources: learning.postman.com gRPC docs ("Using gRPC streaming", "Send a gRPC
request", saved requests), Postman blog announcements, release notes.

Findings file: `docs/archive/2026-10-04-streaming-rpcs/research/postman-sending-model.md` on branch
`research/postman-sending-model`.

## Answer

Resolved 2026-09-24 by a research subagent. Full findings with citations:
[postman-sending-model.md](../research/postman-sending-model.md) (also committed on
branch `research/postman-sending-model`).

1. **Interactive only.** For client-streaming and bidi, *Invoke* opens the stream; there
   is one Message editor; **Send** sends one message per click (edit between sends);
   **End Streaming** half-closes. No batch "N messages, one Send" for a live request (a
   2022 feature request for it is still open). N messages can be authored up front only
   inside an **Example**, then picked one at a time via "Use Example Message".
2. **Saved request = one message body** (+ URL / method / metadata / scripts). A message
   list is persisted only as an *example* ("Message stream": sent/received messages,
   reorderable). Scripts (Before invoke / On message / After response) are assert hooks
   and cannot send or end the stream. Export format unobservable (gRPC collections still
   cannot be exported).
3. **All four kinds shipped together** in the v9.7.1 open beta (Jan 2022) and at v10 GA
   (Sept 2022). No server-streaming-first phase.
4. **Same response surface for all streaming kinds**: a single timeline of sent + received
   + informative messages (newest on top), sent/received filter, search, Clear/Restore.
   The only per-kind difference is that Send / End Streaming appear only for methods
   that send multiple client messages.

Unconfirmed: whether *Invoke* flushes the body as the first message for client/bidi
(inferred: it does not); "must end streaming before saving an example".
