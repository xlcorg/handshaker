# 18: Save messages + Assemble

**What to build:** From a finished Stream call the user can export what was received.
Ctrl/Cmd+S on the pane, and "Save messages to file…" in a menu behind an icon in the
timeline toolbar, save **all inbound messages as one JSON array** in receive order (built
in core from the Stream store; outbound excluded; default name `response-<stamp>.json`).
**Assemble** builds one file from a `bytes` field across all inbound messages: candidates
are every non-repeated `bytes` field of the response type (top-level or through nested
single-message paths), computed in core from the output descriptor at Open and delivered
in `Opened.bytes_fields`; one candidate → "Assemble file from `<path>`…", several → a
submenu, none → no item. Both actions are enabled only in a terminal state (End OK,
End non-OK, Cancel), never while open. Assembly streams to disk through a sink-taking
sibling of the save-via-dialog helper (never one `Vec`), skips messages without the field
(0 bytes), and reports "<size> from N of M messages" in the saved-file toast (open /
reveal-in-folder), naming a non-OK state ("· stream cancelled" / "· `<code>`"). The
default name comes from a `name` / `file_name` / `filename` string field of the first
inbound message, else `stream-<stamp>.<ext>` with the extension sniffed from the first
chunk's leading bytes, `.bin` when unknown.

**Blocked by:** 14 (Walking skeleton), 15 (Timeline toolbar)

**Status:** resolved

- [x] Echo `Download(Ping) → stream Chunk { name, data: bytes }`: after `● OK`, "Assemble file from `data`…" proposes the `name` value and writes the concatenated bytes; the toast reads "<size> from N of N messages"
- [x] A stream cancelled halfway assembles the received chunks; the toast names "· stream cancelled"
- [x] Messages without the field are skipped; the toast reports "from N of M"
- [x] A response type with two `bytes` fields shows a submenu with one item per path; a type with none shows no Assemble item
- [x] Ctrl/Cmd+S and "Save messages to file…" produce one JSON array of all inbound messages, oldest first, without outbound messages; the expanded row's Monaco menu still saves one message
- [x] Both items are disabled while the call is open
- [x] Assembly iterates the Stream store and writes through a sink; no whole-file buffer is allocated
- [x] Default extension sniffed from the first chunk (`classify` + `suggested_extension`), `.bin` fallback
- [x] IPC commands `stream_save_messages(request_id) → Option<path>` and `stream_assemble(request_id, field_path) → Option<AssembleResultIpc { path, written, total, size_bytes }>`; bindings regenerated; TS fixtures
- [x] Core tests over the store (skip rule, name field, sniffing, sink writing); IPC tests; frontend menu tests (candidates → items, terminal-state gating)
- [x] Strings of touched files in the messages module
- [x] Gate green: `pnpm lint` + `pnpm test` + `cargo test --workspace`

## Comments

**2026-09-28 — resolved.** Commits on `claude/streaming-rpcs`: `5d9ba0c` (core + IPC), `13a379a`
(frontend), `bf51cd1` (review fixes).

- **Core** (`crates/handshaker-core/src/stream/assemble.rs`, `stream.rs`): `bytes_fields(output
  desc)` = every non-repeated `bytes` field, top-level or through nested single-message paths
  (repeated / map never entered, oneof members included, recursion guard + depth cap 8) as
  dotted paths, delivered in `Opened.bytes_fields`. `save_messages(request_id) → String` (all
  inbound, oldest first, one pretty-printed array; outbound excluded). `assemble(request_id,
  field_path, &mut dyn Write) → AssembleResult { written, total, size_bytes: u64 }` iterates the
  store's inbound rows, `decode_row` once per message, walks the path, one `write_all` per
  message (counting-sink test proves no whole-file buffer); messages without the field
  contribute 0 bytes. `default_name(...)` = top-level `name` / `file_name` / `filename` of the
  first inbound message, else `stream-<stamp>.<ext>` via `classify` + `suggested_extension`,
  `bin` fallback. `CoreError::StreamNotFound`, `StreamFieldNotFound` (`from_core_error` 21 → 23).
  Echo fixture: `Download(Ping) → stream Chunk { name, data }`; `tests/stream_assemble.rs`.
- **IPC**: `stream_save_messages(request_id) → Option<path>` (default `response-<stamp>.json`,
  stamp via `chrono` `clock` = the TS `responseFileName` format), `stream_assemble(request_id,
  field_path) → Option<AssembleResultIpc { path, written: u32, total: u32, size_bytes: f64 }>`;
  `save_via_dialog_with` = sink-taking sibling of the save-via-dialog helper; decode + write
  run in `spawn_blocking` (`write_file`); `SaveError::{Dialog, Io, Write}` → `Persistence`;
  dialog cancel → `None`. Facade `streamSaveMessages`, `streamAssemble`.
- **Frontend** (`src/features/stream/{exportActions.ts, StreamExportMenu.tsx}`): toolbar
  `actions` slot → menu with "Save messages to file…" and 0 / 1 / submenu Assemble items per
  `entry.bytesFields`; `canExport` = `phase === "ended" || "cancelled"` only; Ctrl/Cmd+S on the
  pane root = Save messages (expanded row's Monaco menu still saves one message); saved-file
  toast with open / reveal + detail "<size> from N of M messages" + " · stream cancelled" /
  " · <code> <NAME>". Strings `messages.stream.export.*`, `workflow.fault.streamNotFound /
  streamFieldNotFound`.
- **Accepted deviations**: extension sniffed over the whole first chunk carrying the field (a
  JSON *fragment* classifies as text → `.txt`); Save-messages array built in memory; Ctrl+S
  with focus inside the expanded Monaco saves the whole array (menu = one message); `chrono`
  added to `src-tauri` (feature-minimal, already transitive) so the command signature matches
  the spec table.
- **Gate**: cargo 459 passed; lint clean; vitest 181 files / 1469 tests. Bindings fresh.
