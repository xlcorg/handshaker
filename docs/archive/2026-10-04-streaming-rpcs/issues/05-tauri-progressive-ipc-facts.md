# Tauri 2: progressive delivery from a command to the webview

Type: research
Status: resolved
Blocked by: —
Map: ../map.md

## Question

Handshaker's IPC is `#[tauri::command]`s typed through tauri-specta into
`src/ipc/bindings.ts`, consumed only via `src/ipc/client.ts`. Today a command returns
once. For a stream call the backend must push many inbound messages, headers, and a final
stream end. Establish, from primary sources (Tauri 2 docs/source, tauri-specta docs/source,
pinned versions in `src-tauri/Cargo.toml` and `package.json`):

1. `tauri::ipc::Channel<T>` — semantics: ordering guarantees, backpressure or buffering
   (what happens if the webview is slower than the producer), max payload, whether
   `send` can fail after the webview dropped the listener, threading (`Send + Sync`).
2. **tauri-specta typing** — does tauri-specta export `Channel<T>` params as
   `TAURI_CHANNEL<T>` in generated bindings (the current `bindings.ts` already imports
   `Channel as TAURI_CHANNEL`), and how a command with a channel arg looks on both sides.
3. **Channel vs events** (`app.emit` / `listen`) for high-frequency per-call data: Tauri's
   own guidance, performance notes, and how to avoid cross-call leakage (per-call channel vs
   global event with request id).
4. **Lifecycle** — a command that returns immediately and keeps a task alive vs a command
   that stays pending until stream end: implications for cancel (the repo's
   `race_cancel_timeout` Notify keyed by `request_id`, `src-tauri/src/commands/grpc.rs`)
   and for error propagation.
5. Serialization cost notes: large JSON strings per message over the channel (WebView2 on
   Windows, WKWebView on macOS) — any documented limits.

Findings file: `docs/archive/2026-10-04-streaming-rpcs/research/tauri-progressive-ipc.md` on branch
`research/tauri-progressive-ipc`.

## Answer

Resolved 2026-09-24 by a research subagent against pinned sources (tauri 2.11.2 / wry
0.55.1 / tauri-specta rc.21 / specta rc.22 / @tauri-apps/api 2.11.0). Full findings with
citations: [tauri-progressive-ipc.md](../research/tauri-progressive-ipc.md) (also
committed on branch `research/tauri-progressive-ipc`).

1. **`Channel<T>`** is `Clone` + `Send + Sync`; `send()` is sync fire-and-forget:
   payload `< 8 KiB` is inlined via `webview.eval`, larger is parked in memory and pulled
   by JS via `plugin:__TAURI_CHANNEL__|fetch`. **Ordering is guaranteed** (per-channel
   index + JS reorder queue). **No backpressure**: a slow webview grows Rust queues + JS
   `pendingMessages`, never blocks the producer. No Tauri size limit on the channel path.
   `send` errs only on serialization failure / dead event loop; a closed webview drops
   silently with `Ok`. Dropping the last clone emits `{end:true}` but **JS has no
   `onclose` hook → stream end must be an explicit message variant.**
2. **tauri-specta** types `Channel<T>` as `TAURI_CHANNEL<T>` — **verified empirically**
   with a throw-away probe command (reverted): `async grpcStreamProbe(requestId: string,
   onEvent: TAURI_CHANNEL<SendReportIpc>): Promise<Result<null, IpcError>>`. The payload
   type needs `Serialize + specta::Type`.
3. **Channel vs events** — Tauri docs: events are "not designed for low latency or high
   throughput" and may arrive out of order; channels "are designed to be fast and deliver
   ordered data" and are "the recommended mechanism for streaming data". Event = global by
   name (leaks across calls, needs request_id filtering + unlisten races); channel =
   per-invoke callback id, auto-unregistered. → per-call `Channel<StreamEventIpc>` with a
   tagged union (`Headers | Message | Trailers | End{status} | Error`).
4. **Lifecycle** — async commands run as detached `async_runtime::spawn` tasks; JS cannot
   cancel a command (#8351 open). Recommended: **pending-until-end** inside the existing
   `race_cancel_timeout` (cancel = `Notify` drops the stream future; `Err` reserved for
   pre-stream failures; terminal status via the channel; the timeout must be re-scoped
   because it becomes a total deadline). Return-and-spawn would need a task registry,
   signal-based cancel and tasks outliving the webview.
5. **Serialization** — one JSON string per message; `≥ 8 KiB` goes through fetch, where a
   maintainer-relayed benchmark shows ~5 ms macOS vs ~200 ms Windows per 10 MB. No
   documented hard limits. Send one gRPC message per channel message; consider raw bytes
   for very large bodies.

Unconfirmed: exact WebView2 fetch scheme; a stray `TAURI_CHANNEL` typedef without
`.events()`; issues #9266 / #10327 unread.
