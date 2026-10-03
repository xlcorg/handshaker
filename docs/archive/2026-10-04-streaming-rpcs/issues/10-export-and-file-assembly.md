# Export from a stream: save messages and assemble a file from a bytes field

Type: grilling
Status: resolved
Blocked by: 08
Map: ../map.md

## Question

Streams are commonly used to transfer large files in pieces (a `bytes` field per message).
The user wants to **reassemble that file** from Handshaker, in addition to plain save:

- **Save messages**: Ctrl/Cmd+S on a stream call saves what — all inbound messages as a
  JSON array, the selected message, other (Postman: ticket 03)?
- **File assembly**: how the bytes field is chosen (auto-detect the single `bytes` field
  in the response type from the descriptor vs user pick), when it is available (only after
  stream end, or progressive), where the raw bytes live so a multi-GB transfer doesn't sit
  as base64 in React state (Rust-side spool/temp file vs decode-on-save), naming/reveal
  (reuse `saveResponse` + reveal-in-folder), and interaction with the retention limit from
  ticket 08 (dropped messages = incomplete file → refuse or warn?).

Resolution = the export rules and the assembly design the spec states.

## Answer

Resolved 2026-09-26 (grilling, seven single-question rounds). Rules the spec states:

1. **Save messages.** Ctrl/Cmd+S on a stream call, and the "Save messages to file…"
   action, save **all inbound messages as one JSON array** in receive order (oldest
   first). Core builds the array from the Stream store (the UI holds no bodies); default
   name follows the unary `response-<localstamp>.json` convention. Outbound messages are
   **not** included. The expanded row's Monaco menu keeps the existing "Save response to
   file…" for that one message. Rejected: NDJSON; selected-message-only for Ctrl+S;
   sent+received with a direction wrapper (Postman's example model).
2. **Assemble — field choice is descriptor-driven.** Candidates = every non-repeated
   `bytes` field of the response type, top-level or through nested single-message paths.
   One candidate → one action "Assemble file from `<path>`…"; several → a submenu, one
   item per path; none → no action. No manual path entry, no dialog.
3. **Availability.** Assemble is offered in **every terminal state**: Stream end (OK or
   non-OK) and Cancel. The success toast names a non-OK state ("… · stream cancelled" /
   "· `<code>`"). Never while the call is open. Rejected: OK-only; progressive
   write-as-you-go (needs a path before Open — out of scope).
4. **Mechanics.** Core streams to disk: iterate the Stream store, decode each inbound
   message, take the chosen field, write it through a `Write` sink — never concatenate
   into one `Vec` (multi-GB transfers). Reuses the native Save-As path
   (`save_bytes_via_dialog` grows a sink-taking sibling) and the saved-file toast with
   open / reveal-in-folder.
5. **Default name.** If the first inbound message carries a string field named `name` /
   `file_name` / `filename`, propose its value; else `stream-<localstamp>.<ext>` with
   `<ext>` from `classify` + `suggested_extension` (base64 module) over the first
   chunk's leading bytes, `.bin` when unknown.
6. **Messages without the field** are skipped (0 bytes) — expected `oneof` semantics
   (header message, progress/keep-alive). The toast reports "<size> from N of M
   messages". Never an error.
7. **Placement.** An icon in the timeline toolbar (ticket 09) opens a menu with both
   actions; items are enabled only in a terminal state. Not in the footer statusline
   (status only), not a right-click menu on the list.
8. **Glossary**: **Assemble (сборка файла)** added to `crates/handshaker-core/CONTEXT.md`
   (Вызов).

Constraints carried forward to ticket 11: two commands over the Stream store —
`stream_save_messages(request_id)` (JSON array → Save-As) and
`stream_assemble(request_id, field_path)` (streamed write → Save-As), both returning
`Option<path>` like `file_save_text` plus the `N of M` / size totals for the toast; the
bytes-field candidate list is computed in core from the method's output descriptor and
exposed to the frontend (with the catalog entry or on Open) so the toolbar menu can render
before stream end; the first inbound message's name-field lookup happens in core at
assemble time.

## Comments

**2026-09-24, input from [ticket 08](08-inbound-buffer-and-metadata-model.md)**: the file
is assembled from the **Stream store** (core-side raw encoded messages, kept for the
step's lifetime, no limit) after stream end — never from what the UI holds; the UI only
knows meta/previews and totals (`message_count`, `total_bytes`). Open here: how the bytes
field is chosen (before Open vs after end), and whether assembly streams the messages to
disk without decoding them all at once.

**2026-09-26, grilling round (one question per round, `/wait-what` re-pitch before each):**

- **Q1 — Save messages**: Ctrl/Cmd+S and a toolbar action above the timeline save **all
  inbound messages as one JSON array** in receive order (oldest first), built by core from
  the Stream store; the expanded row's Monaco menu keeps the existing "Save response to
  file…" for one message. **Outbound messages are not included** (the user wrote them).
- **Q2 — Field choice**: descriptor-driven. Every non-repeated `bytes` field of the
  response type (top-level and through nested single-message paths) is a candidate; one
  candidate → one action "Assemble file from `<path>`…"; several → a submenu, one item per
  field path; none → no action shown. No manual path entry.
- **Q3 — Availability**: assembly is offered in **every terminal state** — Stream end with
  OK, Stream end with a non-OK status, and Cancel. The success toast names the state when it
  is not OK ("assembled from N messages · stream cancelled" / "· `<code>`"). Never while the
  call is open; no progressive write-as-you-go (would need a path chosen before Open — a
  separate feature).
- **Q4 — Mechanics + default name**: assembly streams to disk in core — iterate the Stream
  store, decode each inbound message, take the chosen `bytes` field, write it through a
  `Write` sink; never concatenate into one `Vec`. Default Save-As name: if the first inbound
  message carries a string field named `name` / `file_name` / `filename`, propose its value;
  otherwise `stream-<localstamp>.<ext>` where `<ext>` comes from `classify` +
  `suggested_extension` (base64 module) over the first chunk's leading bytes, `.bin` when
  unknown.
- **Q5 — Messages without the field**: skipped, contributing 0 bytes (expected `oneof`
  semantics — a `{name, size}` header message, progress/keep-alive messages). The toast
  reports the count: "<size> from N of M messages". Never an error.
- **Q6 — Where the actions live**: an icon in the timeline toolbar (ticket 09) opens a
  menu: "Save messages to file…" and "Assemble file from `<field>`…" (submenu when several
  fields). Ctrl/Cmd+S on the pane = Save messages. Items are enabled only in a terminal
  state. Not in the footer (status only, per 09), not a right-click menu on the list.
