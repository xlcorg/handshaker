# Research: Postman gRPC — streaming call lifecycle

Ticket 01 (streaming-rpcs). Researched 2026-09-24 against learning.postman.com,
Postman blog, postman-app-support GitHub issues, the Postman community forum, and
the gRPC spec. Postman's gRPC runtime is closed source, so UI behaviour that the
docs do not spell out is taken from user reports and marked as such.

## Answer

### 1. Deadline / timeout

- Postman's gRPC request has one timeout knob: **Settings → Connection Timeout**,
  documented as "Configure the deadline to invoke and receive the response, in
  milliseconds. To keep the connection open indefinitely, set this value to 0." [D1]
- It is a **gRPC deadline on the whole call**, not an idle gap: Postman staff called
  it "the connection deadline" and, before the setting existed, pointed users at the
  `grpc-timeout` metadata header as the workaround, noting "The default deadline is
  `Infinity`" [G1]. `grpc-timeout` is the wire form of a per-RPC deadline; when
  omitted the server assumes an infinite timeout [S2].
- **Streams are covered by the same deadline and there is no separate idle timeout.**
  The docs phrase the 0 value as keeping "the connection open indefinitely", which
  only makes sense if a non-zero value also bounds a long-lived (streaming) call
  [D1]. No Postman source describes a per-message / idle timeout. The default is
  infinite [G1], so by default a stream is never cut by Postman; a user who sets a
  value gets a whole-call deadline that ends the stream with `DEADLINE_EXCEEDED`
  (standard gRPC semantics [S1]).
- Not directly confirmed: a Postman-side statement that says "applies to streaming"
  in those words (see Unconfirmed).

### 2. Cancel / End by the user

- Two distinct controls: **End Streaming** (client/bidi only — half-closes the
  client side and lets the call finish normally) and **Cancel** (aborts the call)
  [D1][B1].
- **Received messages are kept.** After Cancel, the timeline still lists the
  messages received so far; the cancellation is appended as the *latest* entry
  ("Operation cancelled" as the newest item in the responses log) [U1]. The
  timeline holds "sent, received, and informative messages" in reverse
  chronological order, and there is a separate explicit **Clear Messages** action
  (with Restore) for hiding them — i.e. the app never discards messages on its
  own [D1].
- **Terminal state = the gRPC `CANCELLED` status, shown as an error-style status,
  not a neutral "cancelled" badge.** The status slot shows `1 CANCELED` with the
  message "You have cancelled the execution of the method." plus an informative
  timeline entry "Call cancelled" and "No trailer received" in the trailers area
  [C1]. An independent walkthrough describes the same: "a status code of
  CANCELLED show[s] to the right of the tabs" [U1].
- End Streaming on a client/bidi stream is not a cancel: the server then finishes
  and the call ends with the server's status (the duplex walkthrough: "After ending
  the client stream, the server stream ends") [U1].

### 3. Server-side end

- Messages and the final status live in **different places**: the message
  stream (timeline) holds sent/received/informative entries, while **Status code
  and Time**, **Metadata** (initial) and **Trailers** ("metadata sent by the server
  at the end of a response stream") are separate response-pane areas [D1].
- The end of the call is *also* echoed into the timeline as an informative entry —
  "Call completed" (seen even on unary calls) [G2], "Call cancelled" on cancel
  [C1]. So: status/trailers strip + an informative row in the same list as the
  messages.
- Postman's status wording is `<code> <NAME>`, e.g. `0 OK` for success [D1],
  `1 CANCELED` on cancel [C1]. Scripts run **After response** only once the
  connection closes (per-message logic goes in **On message**) [D2]; in Monitors
  the stream is "closed cleanly" when `pm.response.code.name === "OK"` after the
  stream completes [B2].

### Implication for Handshaker (mirror)

- One deadline setting; apply it as a whole-call gRPC deadline to streams too; 0 /
  unset = no deadline. No idle timeout.
- Cancel keeps everything received, appends a terminal marker to the message list,
  and shows gRPC `CANCELLED` in the normal status slot (error styling is what
  Postman does; a neutral variant would be a deliberate deviation).
- Trailers/status in their own strip, plus a terminal informative row in the list.

## Evidence

- **[D1]** Postman Docs — *The gRPC client interface*
  <https://learning.postman.com/docs/use/send-requests/protocols/grpc/grpc-request-interface/>
  (same text on the legacy path `/docs/sending-requests/grpc/grpc-request-interface/`).
  Verbatim: "Connection Timeout — Configure the deadline to invoke and receive the
  response, in milliseconds. To keep the connection open indefinitely, set this
  value to 0." · "While invoking a streaming method type (client streaming, server
  streaming, or bidirectional streaming), the client-server communication within a
  single session is recorded in the response area as a series of sent and received
  messages in a timeline instead of a single response." · "The message stream
  contains the list of sent, received, and informative messages arranged in reverse
  chronological order (latest appears on the top)." · "End Streaming — Appears when
  you invoke a method that sends multiple messages from the client. Click End
  Streaming to conclude the streaming operation between the client and the
  server." · "Clear Messages — Hides all messages from the view … click Restore to
  restore … all messages." · "Status code and Time — … The 0 OK status code means
  the request succeeded." · "Connection status — displays whether connection with
  the server is active and if messages are streaming." · "Trailers — metadata sent
  by the server at the end of a response stream."
  An archived copy dated 2024-07-09 carries the same Connection Timeout wording:
  <https://docs.devnet-academy.com/docs/postman/sending-requests/grpc/grpc-request-interface/index.html>
- **[D2]** Postman Docs — *Write scripts for gRPC requests*
  <https://learning.postman.com/docs/use/send-requests/protocols/grpc/scripting-in-grpc-request/>
  Script hooks: "Before invoke" (before connecting), "On message" (each message
  received), "After response" ("After closing the connection with the server").
- **[B1]** Postman Blog — *Postman Now Supports gRPC* (2022)
  <https://blog.postman.com/postman-now-supports-grpc/> — feature list includes
  "Cancel a gRPC method at any time" and "Postman will automatically show a unified
  timeline of all events occurring on the connection."
- **[B2]** Postman Blog — *Scheduling gRPC and GraphQL Requests with Postman
  Monitors (Beta)*
  <https://blog.postman.com/scheduling-grpc-and-graphql-requests-with-postman-monitors-beta/>
  — tests run "after the stream completes"; "Stream closed cleanly" =
  `pm.expect(pm.response.code.name).to.eql("OK")`; non-OK statuses such as
  `DEADLINE_EXCEEDED` fail the run.
- **[G1]** GitHub postmanlabs/postman-app-support #11650 *Unable to specify deadline
  for unary gRPC requests* <https://github.com/postmanlabs/postman-app-support/issues/11650>
  — Postman staff (codenirvana, 2023-01-24): workaround = `grpc-timeout` metadata
  (e.g. `1000m`); "The default deadline is `Infinity`". Staff (appurva21,
  2024-08-14): "You can now configure the connection deadline under the "Settings"
  tab in your gRPC request." (comments via
  <https://api.github.com/repos/postmanlabs/postman-app-support/issues/11650/comments>).
- **[G2]** GitHub postmanlabs/postman-app-support #12113 *grpc message is not
  received by postman* <https://github.com/postmanlabs/postman-app-support/issues/12113>
  — user screenshot/description: "What is seen in postman is only 'Call
  completed'" — shows the end-of-call informative row in the message stream.
- **[G3]** GitHub postmanlabs/postman-app-support #13001 *GRPC Reflection not working*
  <https://github.com/postmanlabs/postman-app-support/issues/13001> — Postman
  surfaces cancellation as "1 CANCELLED: Call Cancelled" (reflection context;
  confirms the `1 CANCELLED` wording).
- **[G4]** GitHub postmanlabs/postman-app-support #11215 *[gRPC] scripts should be
  able to be executed after a response in case of a stream call*
  <https://github.com/postmanlabs/postman-app-support/issues/11215> — for server
  streaming the after-response script "is only executed when the stream finishes";
  corroborates that Postman treats the stream as one call with one terminal point.
- **[C1]** Postman Community — *Postman cancel gRPC connection while it should stay
  open* (2025-08-14)
  <https://community.postman.com/t/postman-cancel-grpc-connection-while-it-should-stay-open/83578>
  — user quotes the UI after a cancel: `"1 CANCELED" You have cancelled the
  execution of the method. Call cancelled No trailer received.` (The thread's root
  cause was http vs https; the quote is still a faithful capture of the cancel UI.)
- **[U1]** Andrew Halil — *How to Test gRPC .NET Core Services with Postman*
  (2025-03-06) <https://andrewhalil.com/2025/03/06/how-to-test-grpc-net-core-services-with-postman/>
  — server-streaming walkthrough: messages arrive "every 30 seconds … in the
  Responses tab"; "After cancellation, you will see a status code of CANCELLED show
  to the right of the tabs and the Operation cancelled message as the latest
  message under the responses log". Duplex: "After ending the client stream, the
  server stream ends and the response log in Postman shows both messages sent from
  the client (indicated by the green arrows) and messages received from the server
  (indicated by the blue arrows)". Secondary source (third-party blog with
  screenshots), used only for UI observations.
- **[S1]** gRPC — *Deadlines* guide <https://grpc.io/docs/guides/deadlines/> —
  "A deadline is used to specify a point in time past which a client is unwilling
  to wait for a response from a server." … "the client will give up and fail the
  RPC with the `DEADLINE_EXCEEDED` status."
- **[S2]** gRPC over HTTP/2 spec <https://github.com/grpc/grpc/blob/master/doc/PROTOCOL-HTTP2.md>
  — `Timeout → "grpc-timeout" TimeoutValue TimeoutUnit`; "If Timeout is omitted a
  server should assume an infinite timeout."

## Unconfirmed

- **No Postman document says in so many words that Connection Timeout applies to
  streaming calls.** The conclusion (whole-call deadline, no idle timeout) is an
  inference from the docs wording ("keep the connection open indefinitely" [D1]),
  the staff description of the setting as "the connection deadline" and the
  `grpc-timeout` workaround [G1], and gRPC deadline semantics [S1][S2]. No user
  report of a stream being cut by `DEADLINE_EXCEEDED` in Postman was found either
  way.
- **Default value of the Connection Timeout field** after it shipped (2024-08):
  staff said the pre-setting default was `Infinity` [G1]; whether the field now
  defaults to `0` or to a number is not documented (the screenshot in [G1] could
  not be read).
- **Exact wording/styling of the terminal timeline row**: sources give both
  "Call cancelled" [C1] and "Operation cancelled" [U1] (different Postman versions
  or paraphrase); "Call completed" [G2] for a normal end. Colour/error styling of
  the `CANCELLED` status is not documented — treated as the standard non-OK status
  presentation.
- **Cancel on a client/bidi stream vs End Streaming**: documented for End
  Streaming [D1]; the Cancel button's existence for all method kinds is stated only
  in the launch blog ("Cancel a gRPC method at any time" [B1]) and the community
  quote [C1], not on the current interface page.
- Postman release notes (postman.com/release-notes) could not be fetched in a
  readable form; the 2024-08-14 staff comment [G1] is the dating for the setting.
