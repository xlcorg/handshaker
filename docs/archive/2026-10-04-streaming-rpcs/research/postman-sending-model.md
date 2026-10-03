# Postman: sending model for client-streaming and bidi — research findings

Ticket: `../issues/02-postman-sending-model.md` · Researched: 2026-09-24 · Sources: Postman
Learning Center, Postman blog, `postmanlabs/postman-app-support` GitHub issues, Postman
Community forum. Every claim below carries its URL; anything not backed by a verbatim
quote is listed under **Unconfirmed**.

## Answer

1. **Interactive only.** For any method that streams from the client (client-streaming and
   bidi) Postman keeps the stream open after **Invoke**; the user edits the single
   **Message** editor and clicks **Send** once per message, then clicks **End Streaming**
   to half-close. There is no "author N messages, one Send" batch mode for a live request —
   a 2022 feature request for exactly that (send an array of messages from a file with
   delays) is still an open issue. The only place N messages are authored up front is an
   **Example** (documentation object), whose messages can then be picked one at a time via
   **Use Example Message** while the stream is open.

2. **A saved request persists one message body** (the Message tab), plus URL / method /
   metadata / scripts — the request UI has exactly one JSON "Message" editor, and docs
   describe saving as "Saves the request into a collection". A **list of messages** is
   persisted only as an **example** attached to a saved request ("Message stream":
   multiple messages, each typed sent or received, reorderable). Scripts exist (Before
   invoke / On message / After response) but cannot drive sending or ending the stream —
   they are test/assert hooks; users asking for send-time hooks got open feature requests.
   The on-disk/export format is not observable: Postman still cannot export collections
   containing gRPC requests (open since 2022, staff confirmed "no timelines" in Aug 2024).

3. **All four kinds shipped together** in the first public beta (v9.7.1, 13 Jan 2022):
   "Call unary, client-streaming, server-streaming, and bidirectional-streaming gRPC
   methods". GA in v10 (Sept 2022) re-lists all four. No evidence of a server-streaming-first
   phase.

4. **One response surface for all streaming kinds.** Server-streaming, client-streaming and
   bidi all render the same "timeline" of **sent, received, and informative** messages,
   newest on top, with a filter (all / sent / received), search, and Clear/Restore. The
   only difference is which controls appear: **Send** and **End Streaming** are shown only
   for methods that "send multiple messages from the client" (client-streaming + bidi).
   Sent messages are interleaved with received ones in that one list — so yes, mirror that:
   a single chronological (Postman: reverse-chronological) log, with a sent/received filter,
   rather than separate request/response panes.

## Evidence

### Q1 — interactive sending (Send per message, End Streaming to half-close)

- Postman docs, "The gRPC client interface"
  (https://learning.postman.com/docs/use/send-requests/protocols/grpc/grpc-request-interface/):
  - "**Send** - Appears when invoking a method that sends multiple messages from the client.
    Click **Send** to send the request message to the server."
  - "**End Streaming** — Appears when you invoke a method that sends multiple messages from
    the client. Click **End Streaming** to conclude the streaming operation between the
    client and the server."
  - "Once you have entered the server URL, selected a method, and defined the payload,
    click **Invoke** to invoke the request and get a response from the server."
- Postman docs, "Save, edit, and share gRPC request-response examples", LotsOfGreetings
  (client-streaming) walkthrough
  (https://learning.postman.com/docs/use/send-requests/protocols/grpc/using-grpc-examples/):
  steps are Invoke → "Click the dropdown next to **Use Example Message** to view the
  messages you had saved for the request." → "Select a message from the dropdown list. The
  selected message appears in the request's **Message** tab." → click **Send** → "Open the
  dropdown list again and select a different message." — i.e. the Message editor is
  re-populated between sends while the stream stays open.
- GitHub issue #11287 "Add support for gRPC client streaming from a file" (opened
  2022-09-21, label `feature`, still open, no staff reply)
  (https://github.com/postmanlabs/postman-app-support/issues/11287): describes the current
  model as "the requests can only be sent by typing/editing the whole body in the embedded
  editor and each request requires pushing Send button", and asks for a file containing a
  JSON array of messages with delays — confirming no batch mode exists.
- GitHub issue #12504 "gRPC: Editing and sending messages rapidly results in the incorrect
  payload being sent" (2023-11-28, Postman 10.20.6)
  (https://github.com/postmanlabs/postman-app-support/issues/12504): repro is send →
  edit the body → Send again inside the same stream; confirms edit-between-sends is the
  intended workflow (search summary says fixed in v10.22.2 — see Unconfirmed).
- GitHub issue #12360 (2023-09-27)
  (https://github.com/postmanlabs/postman-app-support/issues/12360): "it is currently
  impossible to use initial metadata in between the initiation of a call and sending the
  first message" — the call is initiated (Invoke) before the first message is sent (Send),
  i.e. Invoke opens the stream and does not itself flush the body for client-streaming/bidi
  (see Unconfirmed for the strength of this inference).

### Q2 — what a saved request persists

- "The gRPC client interface" (URL above): the payload has a single **Message** tab —
  "Compose a message in JSON to send with the request." Save: "Saves the request into a
  collection so that you can reuse it later or share it with others." "To test multiple
  requests with different configurations, you can name each of them individually and save
  them into a collection." No multi-message editor is described for the request itself.
- Examples hold the message list. Postman blog "Show your gRPC APIs in action with
  examples" (2023-02-23)
  (https://blog.postman.com/show-your-grpc-apis-in-action-with-examples/): for streaming
  examples "You can add multiple messages to it, switch between the message types (whether
  sent or received), and reorder them as you need to tell the story you want."
  Docs (using-grpc-examples, URL above): "Click **Add a Message** and select **Message
  stream**." and "Create an example for the request with two different `"greeting"`
  messages and save it." Also: "gRPC examples can't be saved unless the request is in a
  collection."
- Scripts are hooks, not a sending program. Postman docs "Test and debug values in gRPC
  requests using JavaScript"
  (https://learning.postman.com/docs/sending-requests/grpc/scripting-in-grpc-request): three
  hooks — "Before invoking the method and establishing a connection with the server"
  (Before invoke), "When the client receives a message from the server" (On message),
  "After closing the connection with the server" (After response); "Once you invoke your
  gRPC request, updates to scripts in the **On message** tab won't take effect until the
  next time you invoke the request." Blog "Testing gRPC APIs with Postman" (2022-08-10)
  (https://blog.postman.com/testing-grpc-apis-with-postman/) shows only assertions
  (`pm.response.to.have.message(...)`, `pm.response.messages.to.have.jsonSchema(...)`).
  Open requests #12360 and #11215
  (https://github.com/postmanlabs/postman-app-support/issues/11215) ask for hooks
  between metadata and first send / per received message — nothing lets a script emit
  messages.
- Export format unobservable. Community thread (2024-08-21)
  (https://community.postman.com/t/how-can-i-export-the-collection-with-grpc-requests/66848),
  Postman staff: "Currently, there isn't an export option for the non-http Collections.
  This will be introduced into the platform soon though - no timelines for this yet."
  GitHub #11252 (2022-09-09, open; #11775 and #13181 (2024-10-04, v11.15.0) closed as
  duplicates of it) (https://github.com/postmanlabs/postman-app-support/issues/11252).

### Q3 — all kinds shipped together

- Postman blog "Postman Now Supports gRPC" (2022-01-13, "v9.7.1 and above", open beta)
  (https://blog.postman.com/postman-now-supports-grpc/): "Call unary, client-streaming,
  server-streaming, and bidirectional-streaming gRPC methods"; "Postman will automatically
  show a unified timeline of all events occurring on the connection."
- Postman blog "Postman v10 and gRPC: what you can do" (2022-09-15, GA)
  (https://blog.postman.com/postman-v10-and-grpc-what-you-can-do/): "Unary,
  client-streaming, server-streaming, and bidirectional-streaming are all gRPC-supported
  methods."
- Blog "Testing gRPC APIs with Postman" (2022-08-10): "All the features and workflows
  mentioned above extend to unary, client streaming, server streaming, and bidirectional
  streaming gRPC methods alike."

### Q4 — response area: server-streaming vs bidi

- "The gRPC client interface" (URL above): "While invoking a streaming method type (client
  streaming, server streaming, or bidirectional streaming), the client-server communication
  within a single session is recorded in the response area as a series of sent and received
  messages in a timeline instead of a single response." "The message stream contains the
  list of sent, received, and informative messages arranged in reverse chronological order
  (latest appears on the top)." Filter: "Instead of all messages, you can choose to view
  only sent or received messages." "**Clear Messages** — Hides all messages from the view,
  cleaning up the response area so that you can focus on the new messages." plus a
  **Restore** option and a search box. Trailers: "Metadata sent by the server at the end of
  a response stream."
- The docs describe no separate layout per kind; the only kind-dependent element is the
  presence of Send / End Streaming ("Appears when you invoke a method that sends multiple
  messages from the client").
- Related bug reports (not needed for the design, but show the timeline is the sole
  response surface for bidi too): #12734 "postman doesn't print response for bidirectional
  grpc streaming" (2024-03-24, `need-more-info`)
  (https://github.com/postmanlabs/postman-app-support/issues/12734).

## Implications for Handshaker (non-normative)

- Mirror the interactive model: Invoke/Send opens the stream; one body editor; **Send**
  emits the current body; **End streaming** half-closes; Cancel aborts. Batch authoring
  can be deferred (Postman never shipped it in three years; it is still an open request).
- Saved request = one template body (exactly what Handshaker already persists); a
  multi-message list belongs to a separate "example"/scenario entity if ever wanted.
- No reason to phase server-streaming ahead of client/bidi on Postman's precedent: the
  response surface is identical (one interleaved log), only two extra buttons differ.
- Postman orders newest-first; Handshaker may choose chronological — the decision is
  presentation, not model (ticket 03 covers presentation).

## Unconfirmed

- **Invoke does not send the Message-tab body for client-streaming/bidi.** Inferred from
  the LotsOfGreetings steps (Invoke, then pick a message, then Send) and issue #12360's
  wording; no doc sentence states it outright. Verify live in Postman before relying on it.
- **"For streaming methods, you must end streaming before you can save an example."**
  Appeared in a search-engine summary attributed to learning.postman.com, but a fetch of
  the current examples page did not return this sentence verbatim; the page may have been
  restructured. Treat as plausible, unverified.
- **Fix version for #12504 (v10.22.2).** From a search summary; the fetched issue page did
  not show the staff reply.
- **Older doc URLs** `/docs/sending-requests/grpc/using-grpc-streaming/` and
  `/docs/sending-requests/grpc/grpc-examples/` return 404 (docs moved to
  `/docs/use/send-requests/protocols/grpc/…`); no dedicated "Using gRPC streaming" page
  exists any more — streaming is covered inside the client-interface page.
- **Postman changelog / release notes** were not found as a primary source for the
  streaming features; dates above come from the blog posts' publish dates.
- **Persisted format** (collection JSON for a gRPC request) could not be inspected because
  gRPC collections are not exportable (see Q2).
