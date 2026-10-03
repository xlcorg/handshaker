# Postman: streaming response presentation

Type: research
Status: resolved
Blocked by: —
Map: ../map.md

## Question

How does Postman present a streaming response, so the Handshaker pane prototype has a
concrete reference:

1. **Message list** — layout of received messages: expandable cards, one document,
   per-message timestamp / size / index, selection, search/filter across messages,
   newest-first or oldest-first, auto-scroll.
2. **Limits** — is there a cap on retained messages (ring buffer, "dropped" counter) or a
   memory guard? What happens on very long-lived streams?
3. **Headers vs trailers** — are initial metadata (headers) and trailing metadata shown
   separately for streams (and for unary)? Where?
4. **Save / export** — can received messages be saved to a file, in what format (JSON
   array, NDJSON, one message), and is there anything like assembling a file from a bytes
   field across messages?
5. **Status strip** — how the running/ended state, elapsed time and message count are
   shown.

Primary sources: learning.postman.com gRPC docs, Postman blog/screenshots, release notes,
GitHub issues on postman-app-support for limits/export.

Findings file: `docs/archive/2026-10-04-streaming-rpcs/research/postman-stream-presentation.md` on branch
`research/postman-stream-presentation`.

## Answer

Resolved 2026-09-24 by a research subagent. Full findings with citations:
[postman-stream-presentation.md](../research/postman-stream-presentation.md) (also
committed on branch `research/postman-stream-presentation`).

1. **Message list** — one flat timeline (not a document), **newest-first**, mixing sent /
   received / informative rows ("Sent request to…", "Call completed with status 0 (OK)").
   Row = direction arrow + one-line truncated JSON + wall-clock timestamp + expand chevron.
   Text search, All/Sent/Received filter, **Clear Messages** → "N messages hidden
   [Restore]". No index, size, selection or auto-scroll documented. Scripts see
   `pm.response.messages[i].{data,timestamp}`.
2. **Limits** — none documented: no cap, ring buffer, dropped counter or memory guard
   (Restore implies cleared messages stay in memory). Only a per-message "Maximum
   response message size" (MB, 0 = unlimited) and the connection timeout. A crash report
   on a sustained 100 KB/s stream was closed need-more-info.
3. **Headers vs trailers** — separate tabs for unary and streams: `Response | Metadata (n)
   | Trailers | Test results`. Initial metadata is not a timeline row.
4. **Save / export** — only "Save Response → example" (must End Streaming first); the
   example stores the whole sent+received stream inside the collection. **No file export
   of received messages** (no JSON array / NDJSON / single) and **no bytes-field → file
   assembly**; file-related requests are all about sending files, and open.
5. **Status strip** — badge `STREAMING` → `IDLE` on the list toolbar; `0 OK` chip +
   elapsed ms in the header, shown as total duration once the call ends (no live ticker);
   end-of-call is a timeline row; no message counter, no response size; Invoke ↔ Cancel,
   Send / End Streaming for client-side streams.

Unconfirmed: a gRPC "…" save-to-file menu (HTTP-only per docs), per-row size on hover,
timestamp precision, auto-scroll behaviour.
