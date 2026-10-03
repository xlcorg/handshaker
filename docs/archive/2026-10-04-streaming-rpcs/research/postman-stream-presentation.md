# Research: how Postman presents a streaming gRPC response

Ticket 03 (streaming-rpcs). Researched 2026-09-24 against Postman's Learning Center,
Postman blog posts (with their screenshots/GIFs inspected frame by frame), and
`postmanlabs/postman-app-support` GitHub issues. Every claim carries its source; anything
not backed by a primary source is in **Unconfirmed**.

## Answer

### 1. Message list

- **One flat timeline, not one document.** For any streaming method the response area
  becomes "a series of sent and received messages in a timeline instead of a single
  response" [D1]. The list mixes three kinds of rows: **sent**, **received**, and
  **informative** (connection events such as "Sent request to grpcb.in:9000",
  "Call completed with status 0 (OK)", "Connected"/"Disconnected") [D1][B2][B3].
- **Newest-first.** Rows are "arranged in reverse chronological order (latest appears on
  the top)" [D1]. Consequence: there is no auto-scroll-to-bottom; new rows are inserted at
  the top of the list [B2 frames].
- **Row anatomy (from screenshots):** a direction icon (blue down-arrow = received, orange
  up-arrow = sent, info/check icon = informative), the message JSON collapsed to a single
  truncated line, a wall-clock **timestamp** at the right edge, and a chevron to expand
  [B2][B3][W2]. The gRPC GIFs show timestamps at **second** precision (`19:40:05`) [B2];
  a user asked for millisecond precision in June 2023 with no staff reply [C1]. The
  WebSocket pane (same visual component) shows milliseconds (`14:19:45.890`) [W2].
- **Expand/collapse per row.** "Click [chevron] to view a message's contents in the
  message stream" [D1]. Nothing in the docs mentions a per-message **index number** or
  **size** in the gRPC row; the sibling WebSocket pane exposes size/time/MIME type only in a
  hover tooltip [W1].
- **Search + type filter + clear.** A text box filters rows ("Use the text box to search
  for specific messages"); a dropdown filter shows All / Sent / Received; **Clear Messages**
  hides everything so far and shows a "N messages hidden" row with a **Restore** button
  [D1][B2]. A 2024 bug report says the search "randomly hides message or two (from 30+),
  totally unrelated to what I type" — still open [G5].
- **Selection:** no multi-select or checkbox on gRPC rows is documented. The WebSocket pane
  has checkboxes to show the time delta between two messages [W1]; not documented for gRPC.
- **Scripts see the same model:** `pm.response.messages` is a list whose items have
  `data` and `timestamp` (a `Date`), addressable by `idx(n)`, `filter`, `each` [D4][D5];
  an **On message** script hook runs per received message [D6].

### 2. Limits

- **No documented cap, ring buffer, dropped counter, or memory guard.** Neither the
  interface doc [D1] nor any blog post mentions a retained-message limit. The only
  user-facing control is manual **Clear Messages / Restore** [D1] — and Restore implies the
  hidden messages are still kept in memory, i.e. clearing is a view filter, not a purge.
- **Evidence of no guard:** issue #11061 "Postman crashes with gRPC streaming response"
  (July 2022, v9.14) — ~100 KB/s, one message per second, app dies after several minutes;
  closed as `need-more-info`, no fix described [G2]. GitHub search for "grpc messages
  limit" / "grpc streaming memory" in `postman-app-support` returns zero issues [G0].
- **Per-message limit only:** request setting **Maximum response message size** in MB,
  "set this value to 0" for unlimited [D1]; **Connection Timeout** in ms, 0 = keep open
  indefinitely [D1]. Long-lived streams are therefore unbounded by design.

### 3. Headers vs trailers

- **Separate tabs, both for unary and streams.** The response header row has tabs
  **Response | Metadata (n) | Trailers | Test results** [D1][S1]. Older v10 builds labelled
  them **Metadata (1) | Trailing Metadata** [B3 frame]. Metadata = "The response's metadata
  containing information about the run"; Trailers = "metadata sent by the server at the end
  of a response stream" [D1]. The Metadata tab carries a count badge (`Metadata (2)`) [S1].
- For streams the tab strip is the same (**Messages | Metadata | Trailers** in the example
  editor [B4]); initial metadata is *not* inserted as a row in the message timeline.
  A user asked (Sept 2023, open) for a script hook "on initial metadata reception" because
  "it is currently impossible to use initial metadata in between the initiation of a call
  and sending the first message" [G4].
- Script model mirrors it: `pm.response.metadata` and `pm.response.trailers` are separate
  key/value lists [D4]; tests can assert `pm.response.to.have.trailer()` [D7].

### 4. Save / export

- **Only "Save Response → example".** "You can save your gRPC request responses as
  examples. For streaming methods, you must end streaming before you can save an example"
  [D1]. An example of a streaming method stores the **whole sent+received message stream**
  (an editable, reorderable list of sent/received rows with a status-code dropdown) [D2][B4].
  Examples live inside the collection, not on disk.
- **No file export of received messages** is documented for gRPC (no JSON-array, no
  NDJSON, no single-message download). HTTP responses have "View more actions > Save
  response to file" (JSON) [D3]; the gRPC docs do not list it and the gRPC response
  "..." menu is not described [D1]. Collection export of gRPC requests was itself a
  long-running gap (#11252 open, #11579/#11775/#13181 closed) [G6].
- **No bytes-field → file assembly.** The only file-related gRPC requests are the inverse
  direction (send a file / stream a file as bytes: #11287, #11338, both open) [G7].
  Nothing about downloading a `bytes` field or concatenating chunks across messages exists.
- Per-row **Copy message / Save message** actions exist on the WebSocket pane [W1]; the gRPC
  doc lists no per-row actions.

### 5. Status strip

- **Connection-status badge** at the right of the message-list toolbar: **STREAMING**
  while the call is open, **IDLE** after it ends [B2 frames]; the doc calls it "Connection
  status — displays whether connection with the server is active and if messages are
  streaming" [D1]. The WebSocket variant reads **Connected** [W2].
- **Status code + time** in the response header: `0 OK` chip (green) and elapsed
  `93.87 ms` [S1]; older builds print `Status code: 0 OK  Time: 155 ms` [B3]. For streams
  `responseTime` "denotes the total duration for that request execution" [D4] — i.e. the
  time is shown once the call ends, not a live-ticking clock (no running timer is documented
  or visible in the GIF frames).
- **End of call is a timeline row**, not a strip: "Call completed with status 0 (OK)" with
  its own timestamp [B2]. Errors surface via the status code on the same header
  (`2 UNKNOWN` etc. selectable in examples) [D2].
- **Message count:** not shown as a counter. The only count visible is the "6 messages
  hidden" row after Clear [B2]. **Response size** is not shown for gRPC (HTTP shows it [D3]).
- **Controls:** the Invoke button becomes **Cancel** while streaming; client/bidi streams get
  **Send** and **End Streaming** (older builds: **Done**) [D1][B2].

## Evidence

Docs (learning.postman.com, fetched 2026-09-24, "Latest (v12)"):

- [D1] The gRPC client interface — https://learning.postman.com/docs/sending-requests/grpc/grpc-request-interface/
  Verbatim from "The response section":
  - "Response — The information returned by the server after a successful request run."
  - "Metadata — The response's metadata containing information about the run."
  - "Trailers — Trailers are metadata sent by the server at the end of a response stream."
  - "Status code and Time — Contains information about performance and if the request succeeded. ... The 0 OK status code means the request succeeded."
  - "Save Response — You can save your gRPC request responses as examples. For streaming methods, you must end streaming before you can save an example."
  - "Multiple responses — While invoking a streaming method type (client streaming, server streaming, or bidirectional streaming), the client-server communication within a single session is recorded in the response area as a series of sent and received messages in a timeline instead of a single response."
  - "Connection status — The connection status displays whether connection with the server is active and if messages are streaming."
  - "Message stream — The message stream contains the list of sent, received, and informative messages arranged in reverse chronological order (latest appears on the top)."
  - "Expand or collapse message — Click [icon] to view a message's contents in the message stream."
  - "Search — Use the text box to search for specific messages."
  - "Message filter — Click [icon] to adjust the view based on the type of message. Instead of all messages, you can choose to view only sent or received messages."
  - "Clear Messages — Hides all messages from the view, cleaning up the response area so that you can focus on the new messages. Click Restore to restore of all messages."
  - "End Streaming — Appears when you invoke a method that sends multiple messages from the client. Click End Streaming to conclude the streaming operation between the client and the server."
  - Settings: "Maximum response message size — The maximum allowed message size, in megabytes. To receive messages of any size, set this value to 0." / "Connection Timeout — ... To keep the connection open indefinitely, set this value to 0."
- [S1] Screenshot in D1: https://assets.postman.com/postman-docs/v11/grpc-request-sections-v11-4.jpg — response header shows tabs `Response  Metadata (2)  Trailers  Test results`, chip `0 OK`, `93.87 ms`, a `...` menu; toolbar has wrap-lines and search icons; no size figure. (Unary example.)
- [D2] Save, edit, and share gRPC request-response examples — https://learning.postman.com/docs/sending-requests/grpc/using-grpc-examples/ — "Click Add a Message and select Message stream. This creates a sample message stream automatically"; status code dropdown "automatically populated based on the protobuf (protocol buffers) schema" (`2 UNKNOWN`). No export to file mentioned.
- [D3] API response structure (HTTP) — https://learning.postman.com/docs/use/send-requests/response-data/responses/ — "View more actions > Save response to file" saves JSON; "for event-based requests, this is available after the stream is closed"; Time and Size indicators (size breaks down body/headers on hover). Does not mention gRPC.
- [D4] pm.response reference — https://learning.postman.com/docs/tests-and-scripts/write-scripts/postman-sandbox-reference/pm-response/ — `pm.response.messages` items have `data` and `timestamp` ("represented as a Date object"); `pm.response.metadata` / `pm.response.trailers` are key/value lists; "For requests with streaming methods, responseTime denotes the total duration for that request execution".
- [D5] Test gRPC requests (assertion examples) — https://learning.postman.com/docs/sending-requests/grpc/test-examples/ — uses `pm.response.messages.idx(10).data`, `.filter({...})`, `[i].timestamp`, `pm.request.messages.each(...)`.
- [D6] Scripting in gRPC requests — https://learning.postman.com/docs/sending-requests/grpc/scripting-in-grpc-request/ — three hooks: "Before invoke", "On message" ("When the client receives a message from the server"), "After response".
- [D7] pm.message reference — https://learning.postman.com/docs/tests-and-scripts/write-scripts/postman-sandbox-reference/pm-message/ — `pm.message` has `data`, `timestamp`; only in On message scripts. `pm.response.to.have.trailer()` is referenced by the test-examples page surfaced in search [D5].
- [W1] Work with WebSocket messages — https://learning.postman.com/docs/sending-requests/websocket/work-with-websocket-messages/ — "Response messages also contain a timestamp in your local time"; "click their checkboxes" for time difference; "Copy message", "Save message"; hover icon shows "a message's size, time, and MIME type"; per-message Text/HTML/JSON/XML, Wrap Line, Show Hexdump, Search.
- [W2] Screenshot in W1: https://assets.postman.com/postman-docs/v12/websocket-messages-v12-01.png — rows with direction arrows, one-line truncated JSON, millisecond timestamps, chevrons; toolbar Search / All Messages / Clear Messages; header badge `Connected` + `Save Response` + `...`.

Blog (blog.postman.com):

- [B1] Postman Now Supports gRPC (Jan 2022) — https://blog.postman.com/postman-now-supports-grpc/ — "Postman will automatically show a unified timeline of all events occurring on the connection"; "powerful search and filtering options, so you can eliminate noise"; "Send metadata, and view incoming metadata".
- [B2] GIF in B1: https://blog.postman.com/wp-content/uploads/2022/01/grpc-streaming.gif (107 frames, inspected at ~35/60/85/98 %). Shows a BidiHello call: toolbar `Search | All Messages ▾ | Clear Messages` + badge `STREAMING` → `IDLE`; rows (top to bottom, newest first) "Call completed with status 0 (OK)  19:40:05", `↓ {"reply":"hello labore non"}  19:40:05`, `↑ {"greeting":"labore non"}  19:40:03`, then "6 messages hidden  [Restore]"; first row after invoke is `ⓘ Sent request to grpcb.in:9000  19:39:47`; buttons `Done` / `Send`, top-right `Cancel` while streaming, `Invoke` after.
- [B3] Postman v10 and gRPC: what you can do (2022) — https://blog.postman.com/postman-v10-and-grpc-what-you-can-do/ ; GIF https://voyager.postman.com/gif/v10-blog/messages-sterling-postman.gif — unary response header `Response  Metadata (1)  Trailing Metadata  Test results` and `Status code: 0 OK   Time: 155 ms` (old label for Trailers).
- [B4] Show your gRPC APIs in action with examples (Feb 2023) — https://blog.postman.com/show-your-grpc-apis-in-action-with-examples/ — "the response area in the example turns into a message stream editor"; add/reorder sent and received messages. Screenshot https://blog.postman.com/wp-content/uploads/2023/02/reorder-scaled.jpg shows example tabs `Messages | Metadata | Trailers`, `Status code: 0 OK ▾`, `All Messages ▾`, rows with `Connected` (bottom) / `Disconnected` (top) informative rows — again newest on top.

GitHub, postmanlabs/postman-app-support:

- [G0] GitHub issue search (API, 2026-09-24): `grpc messages limit` → 0 results; `grpc streaming memory` → 0; `grpc messages clear` → 0; `grpc bytes download` → 0.
- [G2] #11061 Postman crashes with gRPC streaming response (2022-07-06, closed, `need-more-info`) — https://github.com/postmanlabs/postman-app-support/issues/11061 — ~100 KB/s, 1 msg/s, crash after several minutes; no fix described.
- [G3] #11215 scripts should run after each response in a stream (2022-08-25, closed) — https://github.com/postmanlabs/postman-app-support/issues/11215 — "it is only executed when the stream finishes"; the current "On message" hook [D6] addresses this.
- [G4] #12360 run a script on initial metadata reception (2023-09-27, open) — https://github.com/postmanlabs/postman-app-support/issues/12360 — Postman "distinguishes between these types" of metadata; initial metadata unusable mid-stream.
- [G5] #13204 gRPC responses search feature misbehaving (2024-10-14, open, v11.16.1) — https://github.com/postmanlabs/postman-app-support/issues/13204.
- [G6] Collection export gaps: #11252 (open), #11579, #11775, #13181 (closed) — https://github.com/postmanlabs/postman-app-support/issues/11252 etc.
- [G7] File-as-bytes requests, inverse direction only: #11287 (open) https://github.com/postmanlabs/postman-app-support/issues/11287 , #11338 (open) https://github.com/postmanlabs/postman-app-support/issues/11338.
- [G8] #11140 configurable MaxCallSendMsgSize (2022-08-02, closed) — https://github.com/postmanlabs/postman-app-support/issues/11140 — the "Maximum response message size" setting [D1] is the shipped answer (inference: issue closed without comment).
- [G9] #11047 live streaming only to first tab (2022-06-29, closed) — https://github.com/postmanlabs/postman-app-support/issues/11047.

Community:

- [C1] community.postman.com "Grpc testing reponse time and script callback" (June 2023) — https://community.postman.com/t/grpc-testing-reponse-time-and-script-callback/48191 — "is it possible to change on a streaming responses the timestamp to see millisecond actualy it just show second level precision"; no staff reply.

## Unconfirmed

- **Whether the gRPC response "..." menu offers "Save response to file".** It exists for HTTP
  [D3] and the gRPC header has a `...` button [S1], but no gRPC doc lists it and I could not
  run the app. Treat as *not available for streams*.
- **Whether gRPC rows show size / index / MIME on hover** like the WebSocket pane [W1]. The
  two panes look identical in screenshots, but the gRPC doc omits these actions.
- **Current timestamp precision in gRPC rows.** 2022 GIFs show seconds [B2]; the 2024/2025
  WebSocket screenshot shows milliseconds [W2]; no gRPC screenshot after 2022 was found.
- **Release-note dates** for the Trailing Metadata → Trailers rename, STREAMING/IDLE badge,
  or Restore feature: postman.com/release-notes is a JS app that returned no text.
- **Any internal retained-message limit.** Absence of documentation and of issues is not
  proof there is none; #11061 suggests there was none as of v9.14.
- **Auto-scroll behaviour** when the list is scrolled down while new rows arrive at the top.
