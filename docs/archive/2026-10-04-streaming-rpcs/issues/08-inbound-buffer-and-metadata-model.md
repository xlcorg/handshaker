# Inbound buffer and metadata model

Type: grilling
Status: resolved
Blocked by: 03, 04
Map: ../map.md

## Question

Decide what the frontend holds for a stream call and what the backend guarantees:

- **Retention**: unbounded list of inbound messages vs ring buffer with a pref (default
  N, 0 = unlimited, "dropped" counter), informed by Postman (ticket 03). Where the
  authoritative buffer lives (Rust side with the webview holding a window, or the webview
  holding everything).
- **Per-message meta**: index, arrival offset (ms since Send), encoded size — which of
  these the wire carries.
- **Stream start vs stream end**: surface initial metadata (headers) — for streams only or
  also unary (Headers tab is empty today) — and trailing metadata + status at stream end,
  per tonic's actual availability (ticket 04).
- **Glossary**: whether "Stream start" earns a term.

Resolution = the data model the spec states for a stream call's observable state.

## Answer

Resolved 2026-09-24 (grilling, six single-question rounds). Rules the spec states:

1. **Core owns the call: the Stream store.** The user's typical stream is a large file
   delivered in chunks, to be assembled at stream end (ticket 10), so the authoritative
   record lives where the bytes already are. A per-call store keyed by `request_id`
   holds every inbound *and* outbound message in its **raw encoded form** (protobuf
   bytes as received / sent, no JSON inflation); decoding to JSON is lazy, per request.
   The webview holds only per-message meta + previews. Rejected: webview-only buffer
   (Postman's model — base64 chunks through IPC cost ~200 ms per 10 MB on Windows, and
   assembling a file from JS strings is backwards); Rust + webview both full (memory ×2).
2. **No retention limit.** No count cap, no bytes budget, no pref, no eviction, no
   spill to disk (Postman has none either). Memory is the user's responsibility; the
   store is freed by rule 5. Rejected: a "Max retained stream data" pref that stops the
   call at the cap; ring buffer (breaks file assembly); spill to temp file (out of scope).
3. **Per-message event** (Postman's row: direction, one-line truncated JSON, wall-clock
   time, chevron). Core sends for every inbound message: `index` (u32 from 1,
   monotonic, one numbering shared with outbound — internal key, not shown),
   `at_ms` (wall clock, epoch ms, from core; the row shows local time; offsets from
   Open are derived in the frontend), `size_bytes` (raw encoded size — the progress
   figure for file streams), `preview` (**always**: first ~200 chars of compact JSON),
   `json` (full pretty proto3-JSON, same form as unary `response_json`, **inline only
   if `size_bytes` ≤ 64 KiB**, else `null` and the frontend fetches it on expand via a
   `stream_message(request_id, index)` command). Rejected: always inline (a 1 MB chunk
   = ~1.4 MB JSON per `webview.eval`, the webview drowns on the main scenario); 8 KiB
   threshold (mid-size subscription events would need a click). Outbound messages
   (client/bidi) enter the timeline from the `Send message` ack, which returns the same
   fields plus the **resolved** JSON that went on the wire; core stores them in the same
   store.
4. **Initial metadata for stream calls only.** A `Headers` event at stream start
   carries the initial metadata; the Headers tab comes alive for streams. Unary is
   untouched: tonic merges trailers into `Response::metadata()` for `unary` (research 04
   p.2), and separating them means calling unary through `server_streaming` — the
   unification ruled out of scope. Consequence for ticket 11: call client-streaming via
   `Grpc::streaming()`, not `client_streaming()`, which merges the same way.
5. **Stream end event and store lifetime.** `End` carries what `UnaryOutcome` carries
   minus `response_json`: `status_code`, `status_message`, `status_details`,
   `trailing_metadata`, `elapsed_ms` (Open → end), plus totals `message_count` /
   `total_bytes`. A non-OK status mid-stream is the same `End`; received messages stay.
   Cancel is the client-side terminal state of ticket 06 — no wire event. The store
   lives as long as the step that produced it: freed on a new Send/Open of the same step
   (replaced), on removing the step from history / closing the workflow (frontend calls
   `stream_release(request_id)`), and on app exit (memory only). Core also frees on
   channel drop as a safety net.
6. **History snapshot** (graduated from the fog): a stream step's executed snapshot =
   `request_id` + the meta list + `End`; bodies stay in the store. History survives
   re-renders but not an app restart — same as today's in-memory history.
7. **Glossary** (`crates/handshaker-core/CONTEXT.md`, Вызов): **Stream start** (server
   accepted the call, initial metadata received; late for client/bidi, never a UI gate)
   and **Stream store** added.

Constraints carried forward: ticket 10 assembles the file from the Stream store after
stream end (not from anything the UI holds); ticket 11 shapes `stream_message`,
`stream_release`, the `Send message` ack, the 64 KiB inline rule and `streaming()` for
client-streaming; ticket 09 renders rows from `preview` and opens bodies lazily.

## Comments

**2026-09-24, input from [ticket 07](07-sending-model-and-phasing.md)**: for client/bidi
initial metadata may arrive only after Half-close (or not before the first inbound
message), so "stream start" is not a phase the UI can wait for before enabling Send
message. Weigh that when deciding whether the term earns a place.
