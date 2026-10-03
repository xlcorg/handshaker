# Research — Tauri 2: progressive delivery from a command to the webview

Ticket 05 (streaming RPCs). Question: how does the Rust backend push many inbound
messages, headers and a final "stream end" to the webview, given Handshaker's IPC shape
(`#[tauri::command]` + tauri-specta → `src/ipc/bindings.ts` → `src/ipc/client.ts`,
cancel/timeout race keyed by `request_id` in `src-tauri/src/commands/grpc.rs`).

Pinned versions (this worktree, 2026-09-24): `tauri 2.11.2`, `tauri-runtime-wry 2.11.2`,
`wry 0.55.1`, `tauri-macros 2.6.2`, `tauri-specta =2.0.0-rc.21` (macros rc.16),
`specta =2.0.0-rc.22`, `specta-typescript =0.0.9` (`Cargo.toml` / `Cargo.lock`);
`@tauri-apps/api ^2` resolved to `2.11.0` (`pnpm-lock.yaml`). Everything below about
mechanics was read from the *pinned* crate sources in the local cargo registry and the
pinned npm package; web sources are used for guidance/history only.

---

## Answer

### 1. `tauri::ipc::Channel<T>` — semantics

`Channel<TSend = InvokeResponseBody>` is an `Arc`-shared handle: `Clone`, and auto
`Send + Sync` (the inner holds `Box<dyn Fn(InvokeResponseBody) -> Result<()> + Send + Sync>`),
so it can be cloned into a `tokio::spawn`ed task or held across `.await`. `send(&self, data)`
is **synchronous, non-async, fire-and-forget**: it serializes `data` with
`serde_json::to_string` (blanket `IpcResponse for T: Serialize`; `InvokeResponseBody::Raw`
for bytes), assigns a monotonically increasing per-channel `index`, and then either (a) for
JSON `< 8192` bytes (raw bytes `< 1024`) evaluates
`window.__TAURI_INTERNALS__.runCallback(<id>, { message: <json literal>, index: <n> })`
in the webview, or (b) parks the body in an in-memory `ChannelDataIpcQueue`
(`HashMap<u32, InvokeResponseBody>` in managed state) and evaluates a snippet that makes
the JS side `invoke('plugin:__TAURI_CHANNEL__|fetch')` to pull it. **Ordering** is
guaranteed on the JS side: `Channel` keeps `nextMessageIndex` and a `pendingMessages`
queue and delivers to `onmessage` strictly in `index` order, even when a large
(fetch-path) message finishes after a later small (eval-path) one. **Buffering /
backpressure: none.** `webview.eval` posts a `WebviewMessage::EvaluateScript(String)` onto
the tao event-loop proxy (unbounded user-event queue) and returns immediately; the main
thread later calls `ICoreWebView2::ExecuteScript` (Windows) / `evaluateJavaScript`
(macOS), both asynchronous. A producer faster than the webview grows the event-loop queue
(script strings), the `ChannelDataIpcQueue` map (for ≥ 8 KiB messages), and the JS
`pendingMessages` array — nothing ever blocks or signals the Rust side, and every script
occupies the UI thread. **Max payload:** Tauri imposes no channel-specific limit; the
channel path uses `format_raw_js` with no size check (the `2^30-2` `MAX_JSON_STR_LEN`
debug assertion is on the *command-result* path only). Practical ceilings are the JS
engine's max string (V8: `2^29-24` chars) and webview memory. **`send` failure modes:** it
returns `Err` only for serialization failure or when the runtime message cannot be posted
(event loop gone → `FailedToSendMessage`). If the webview was closed but the app runs,
runtime-wry finds no webview for that id and **silently drops** the script; if the page was
reloaded (callback id unregistered), `runCallback` logs
`[TAURI] Couldn't find callback id … app is reloaded while Rust is running an asynchronous operation`
and `send` still returns `Ok`. Rust cannot observe a dropped listener. **Drop:** when the
last Rust clone is dropped, the channel evals `{ end: true, index }` and the JS side
unregisters the callback once all earlier indices were delivered — but there is **no
public JS hook for `end`** (no `onclose`); stream end must be an explicit message variant.

JS side (`@tauri-apps/api/core` 2.11.0):

```ts
import { Channel, invoke } from "@tauri-apps/api/core";
const onEvent = new Channel<StreamEventIpc>();      // or new Channel(handler)
onEvent.onmessage = (msg) => { /* delivered in send order */ };
await invoke("grpc_stream", { requestId, draft, ctx, opts, onEvent });
// serialized to the backend as the string "__CHANNEL__:<callback id>"
```

Rust side:

```rust
use tauri::ipc::Channel;

#[tauri::command]
#[specta::specta]
async fn grpc_stream(
    state: State<'_, AppState>,
    request_id: String,
    on_event: Channel<StreamEventIpc>,   // StreamEventIpc: Serialize + specta::Type
) -> Result<StreamSummaryIpc, IpcError> {
    on_event.send(StreamEventIpc::Headers { .. })?;   // tauri::Result<()> -> map to IpcError
    ...
}
```

A channel can also arrive nested inside a DTO as `tauri::ipc::JavaScriptChannelId`
(`.channel_on(webview)`), not only as a top-level argument.

### 2. tauri-specta typing

Yes. tauri's `specta` feature (enabled transitively — tauri-specta rc.21 depends on
`tauri` with `features = ["specta"]`) declares
`#[specta(remote = Channel)] struct TAURI_CHANNEL<TSend>`, so a `Channel<T>` parameter is
rendered as `TAURI_CHANNEL<T>`; tauri-specta's generated globals already do
`import { invoke as TAURI_INVOKE, Channel as TAURI_CHANNEL } from "@tauri-apps/api/core"`
(that is the import Handshaker's `bindings.ts` line 1016 carries today), and
`Builder::events()` removes the `Channel` type id from the type map so no stray
`export type TAURI_CHANNEL` is emitted. **Verified empirically in this worktree** with a
throw-away command (reverted, not committed):

```rust
#[tauri::command]
#[specta::specta]
pub async fn grpc_stream_probe(
    request_id: String,
    on_event: tauri::ipc::Channel<SendReportIpc>,
) -> Result<(), IpcError> { … }
```

`cargo run -p handshaker --bin export-bindings --features export-bindings` produced:

```ts
async grpcStreamProbe(requestId: string, onEvent: TAURI_CHANNEL<SendReportIpc>) : Promise<Result<null, IpcError>> {
    try {
    return { status: "ok", data: await TAURI_INVOKE("grpc_stream_probe", { requestId, onEvent }) };
} catch (e) {
    if(e instanceof Error) throw e;
    else return { status: "error", error: e  as any };
}
},
```

and the only other `TAURI_CHANNEL` occurrence in the file is the import. Frontend usage
through the facade: `client.ts` re-exports `Channel` from `@tauri-apps/api/core` (the
bindings' `TAURI_CHANNEL` is the same class), creates one per call and passes it as
`onEvent`. Caveats: the payload type must derive both `serde::Serialize` and
`specta::Type`; the tauri-specta rc.21 crate docs still say Channel is "Coming soon"
(issue #111, closed after tauri PR #10435 fixed the remote impl in 2.0.0-beta.26) — the
support is real but undocumented; and `.events(...)` must be called on the builder
(Handshaker does, after `.commands(...)`).

### 3. Channel vs events for per-call high-frequency data

Tauri's own guidance ("Calling the Frontend from Rust"): events are for "situations where
small amounts of data need to be streamed or you need to implement a multi consumer multi
producer pattern", "the event system is not designed for low latency or high throughput
situations", "event payloads are always JSON strings making them not suitable for bigger
messages", and "if a listener is async and the event emitter sends multiple events in
rapid succession, the listeners may process events out of order. For ordered,
high-throughput data delivery, consider using Channels instead"; "Channels are designed to
be fast and deliver ordered data. They are used internally for streaming operations such
as download progress, child process output and WebSocket messages"; and ("Calling Rust")
"The Tauri channel is the recommended mechanism for streaming data such as streamed HTTP
responses to the frontend." Mechanically both ride the same `webview.eval` path
(`emit_js` builds `window['<emit fn>']({event, payload}, [ids])`), so the difference is
not transport cost but *dispatch*: an event is routed by **name** through a global
listener registry (`plugin:event|listen` + `transformCallback`), a channel is routed by a
**per-instance callback id** with index ordering and automatic unregistration on `end`.
Cross-call leakage: with a global event (`grpc:stream-message`) every listener sees every
call's messages, so each payload must carry `request_id`, every listener must filter, and
an `unlisten` racing late messages is the caller's problem; with a per-call channel none
of that exists — the call owns its `Channel`, nothing else can receive on it, and the
callback dies with the Rust handle. Recommendation: **per-call `Channel<StreamEventIpc>`**
with a tagged union (`Headers | Message | Trailers | End{status} | Error`), keeping
`request_id` only for the cancel path. Keep tauri-specta typed events (`ContractUpdated`)
for broadcast state changes.

### 4. Lifecycle — pending-until-end vs return-and-spawn

Async commands are executed by `async_runtime::spawn` (tauri-macros wrapper →
`Invoke::resolver.respond_async_serialized` → `respond_async_serialized_inner` →
`crate::async_runtime::spawn`); the JS promise settles when that task completes. **The
frontend cannot cancel a command**: `invoke` has no abort support (tauri issue #8351,
open) and dropping/ignoring the promise does nothing to the task — cancellation is always a
signal the app sends itself (`grpc_cancel` + `Notify`, exactly what Handshaker does).

*Option A — command stays pending until stream end* (`grpc_stream(..., on_event) ->
Result<StreamSummaryIpc, IpcError>` awaited inside `race_cancel_timeout`): cancel works
unchanged — `Notify` wins the `select!`, the `work` future (and the tonic `Streaming`) is
dropped, the `DeregisterGuard` removes the id. The `Channel` is dropped when the command
returns → JS gets `end`. Error propagation: an error **before** the first message surfaces
as `Err` on the promise exactly like today; an error **after** messages started also
surfaces as `Err`, but by then the UI has rendered partial data, so the frontend must treat
a late `Err` as "stream aborted" — or, cleaner, the command sends a terminal
`End{status}`/`Error` message through the channel and reserves `Err` for pre-stream
failures (resolve/connect). Timeout semantics change: `tokio::time::timeout` around the
whole stream becomes a *total* deadline; a server stream needs either no deadline or a
separate idle/first-message timeout.

*Option B — return immediately, keep a `tokio::spawn`ed task alive*: the command
registers `request_id`, spawns a task owning a `Channel` clone, returns `Ok(())`. Now
dropping the command future no longer cancels anything — cancel must reach the task
(`Notify`/`CancellationToken` polled inside the task, or a stored `JoinHandle::abort`),
so a task registry replaces the current `in_flight` guard; **all** errors after return can
only travel through the channel (the promise has already resolved); tasks can outlive the
webview page (reload → console warnings, closed webview → silent drops) and must be
reaped; `end` fires when the task drops its channel. More moving parts for no gain here.

Recommendation: **A**, on top of the existing race, with `StreamEventIpc` carrying the
terminal status and the timeout re-scoped.

### 5. Serialization notes (per-message JSON over the channel)

Each `send` = one `serde_json::to_string` on the producer thread + one script/fetch on the
UI thread. The 8 KiB / 1 KiB thresholds come from Tauri's own measurements ("8192 byte
JSON payload runs roughly 2x faster through eval than through fetch on WebView2 v135";
"1024 byte payload runs roughly 30% faster through eval than through fetch on macOS").
Messages `≥ 8 KiB` go through the fetch path, where a maintainer-reported non-scientific
benchmark of the binary IPC gives **≈5 ms on macOS vs ≈200 ms on Windows for 10 MB**
("it still uses the fetch api (without actually hitting the network) so there's a bit of a
delay"; "with the currently used system webviews I believe that we can't improve it much
further"). No documented hard payload limit exists in Tauri, WebView2 (`ExecuteScript`:
"no special limitation of the length of the script" — MS Q&A, not an official doc) or
WKWebView; the effective ceilings are the JS max string length (V8 `2^29-24` chars,
JavaScriptCore `2^31-1`) and webview memory ("the webview process … is subject to the same
memory limitations as a browser"). Practical guidance for streaming gRPC: send **one gRPC
message per channel message** (already a JSON string from the core), never accumulate the
whole stream into one payload, expect Windows to be an order of magnitude slower on
multi-MB messages, and, if very large messages become a problem, switch that variant to
`InvokeResponseBody::Raw`/`tauri::ipc::Response` bytes (JS receives an `ArrayBuffer`) or
keep the existing size-gated response handling. Because the eval path embeds the
serde_json string verbatim as a JS object literal, key order is preserved end-to-end
(consistent with the `serde_json` `preserve_order` decision already in the repo).

---

## Evidence

Local pinned sources (paths under `~/.cargo/registry/src/index.crates.io-*/`, npm under
`node_modules/@tauri-apps/api/`; docs.rs mirrors of the same files linked where they
exist):

- **[C1]** `tauri-2.11.2/src/ipc/channel.rs`
  (<https://docs.rs/tauri/2.11.2/src/tauri/ipc/channel.rs.html>) — `Channel<TSend = InvokeResponseBody>`
  with `Arc<ChannelInner>`; manual `impl Clone`; `OnMessageFn = Box<dyn Fn(InvokeResponseBody)
  -> Result<()> + Send + Sync>`; `send(&self, data: TSend) -> crate::Result<()> where TSend:
  IpcResponse` calling `(self.inner.on_message)(data.body()?)`; `MAX_JSON_DIRECT_EXECUTE_THRESHOLD
  = 8192` and `MAX_RAW_DIRECT_EXECUTE_THRESHOLD = 1024` with the quoted benchmark comments;
  `channel_on` closure: `counter.fetch_add(1)` index, `webview.eval(format_raw_js(callback_id,
  "{ message: <json>, index: <n> }"))` for small JSON, `ChannelDataIpcQueue` insert + JS
  `invoke('plugin:__TAURI_CHANNEL__|fetch', …, { headers: { 'Tauri-Channel-Id': … } })` for large;
  `on_drop` evals `{ end: true, index }`; `impl Serialize` → `"__CHANNEL__:<id>"`;
  `JavaScriptChannelId` + `channel_on`; `CommandArg` impl parsing the `__CHANNEL__:` string;
  `#[cfg(feature = "specta")] #[specta(remote = super::Channel)] struct TAURI_CHANNEL<TSend>`;
  the `fetch` command removes the parked body from the map (nothing else does).
- **[C2]** `tauri-2.11.2/src/ipc/mod.rs` — `impl<T: Serialize> IpcResponse for T` (`serde_json::to_string`),
  `enum InvokeResponseBody { Json(String), Raw(Vec<u8>) }`, `Resolver::respond_async_serialized` →
  `respond_async_serialized_inner` → `crate::async_runtime::spawn(async move { … return_result(…) })`.
- **[C3]** `tauri-2.11.2/src/ipc/format_callback.rs` — `format_raw_js(callback_id, js)` =
  `window.__TAURI_INTERNALS__.runCallback({id}, {js})` with no size check; `MAX_JSON_STR_LEN =
  2^30 - 2` debug assertion lives in `serialize_js_with` (command-result path only).
- **[C4]** `tauri-2.11.2/src/webview/mod.rs` — `Webview::eval` → `dispatcher.eval_script(js)`;
  `emit_js` → `self.eval(emit_js_script(…))`; `tauri-2.11.2/src/event/mod.rs::emit_js_script`
  builds `(function () { const fn = window['…']; fn && fn({event: '…', payload: <json>}, [ids]) })()`.
- **[C5]** `tauri-runtime-wry-2.11.2/src/lib.rs` — `eval_script` → `send_user_message(…,
  WebviewMessage::EvaluateScript(script))`; `send_user_message` (l.235–255): on the main thread
  handles inline, otherwise `context.proxy.send_event(message).map_err(|_| Error::FailedToSendMessage)`;
  the handler (l.3752–4060) does `if let Some((Some(window), Some(webview))) = webview_handle {
  match … WebviewMessage::EvaluateScript(script) => if let Err(e) = webview.evaluate_script(&script)
  { log::error!("{e}") } }` with **no else branch** — unknown webview ⇒ silently dropped.
- **[C6]** `wry-0.55.1/src/webview2/mod.rs` l.1321–1335 — `execute_script` calls
  `ICoreWebView2::ExecuteScript(&js, &ExecuteScriptCompletedHandler…)` (asynchronous COM call);
  `wry-0.55.1/src/wkwebview/mod.rs` l.720 — `eval` → `evaluateJavaScript` with completion block.
- **[C7]** `@tauri-apps/api@2.11.0/core.js`, `class Channel` — `#nextMessageIndex`,
  `#pendingMessages`, `#messageEndIndex`; delivers in-order, queues out-of-order indices,
  `'end' in rawMessage` → `cleanupCallback()` (`unregisterCallback(this.id)`) with no user hook;
  `onmessage` setter/getter; `toJSON()` → `` `__CHANNEL__:${this.id}` ``; id from
  `transformCallback`. `invoke(cmd, args, options)` → `window.__TAURI_INTERNALS__.invoke`.
  `event.js::listen` → `invoke('plugin:event|listen', { event, target, handler: transformCallback(handler) })`.
- **[C8]** `tauri-2.11.2/scripts/core.js` — `runCallback(id, data)`: unknown id ⇒
  `console.warn("[TAURI] Couldn't find callback id … This might happen when the app is reloaded
  while Rust is running an asynchronous operation.")`; `unregisterCallback` deletes from the map.
- **[C9]** `tauri-macros-2.6.2/src/command/wrapper.rs` l.378/389 — async command bodies are
  wrapped in `__tauri_resolver__.respond_async_serialized(async move { … })`.
- **[C10]** `tauri-specta-2.0.0-rc.21`: `Cargo.toml` `[dependencies.tauri] features = ["specta"]`;
  `src/lang/globals.ts` l.1–4 (`Channel as TAURI_CHANNEL` import); `src/builder.rs` l.179–180
  `self.types.remove(<tauri::ipc::Channel<()> as specta::NamedType>::sid())` inside `events()`;
  `src/lib.rs` l.175–177 `# Channel — [Coming soon...](…/issues/111)`; `src/lang/ts.rs`
  `render_commands` renders each arg via `ts::datatype(…)` (hence `TAURI_CHANNEL<T>`).
- **[C11]** Empirical export in this worktree (probe command above, `CARGO_TARGET_DIR` reuse,
  output inspected with `grep -n TAURI_CHANNEL src/ipc/bindings.ts` → only l.110 signature and
  l.583 import). Probe reverted with `git checkout --`; nothing committed.
- **[C12]** Handshaker: `src-tauri/src/lib.rs` `specta_builder()` calls `.commands(…)` then
  `.events(collect_events![ContractUpdated])`; `src-tauri/src/commands/grpc.rs`
  `race_cancel_timeout` (`tokio::select! { biased; _ = notify.notified() => Err(Cancelled),
  r = tokio::time::timeout(…, work) => … }` + `DeregisterGuard`) and `grpc_cancel`
  (`notify_one()` on the registered `Notify`); `src/ipc/bindings.ts` l.1014–1018 globals import.
- **[C13]** `Cargo.toml` (workspace) l.55–66 and `Cargo.lock` — pinned versions listed above;
  `src-tauri/Cargo.toml` l.34 `tauri = { workspace = true, features = ["devtools"] }` (the `specta`
  feature comes from tauri-specta).

Web / primary docs:

- **[D1]** Tauri v2 docs, "Calling the Frontend from Rust" — <https://v2.tauri.app/develop/calling-frontend/>
  (quotes in §3: events vs channels, ordering caveat, `download(app, url, on_event: Channel<DownloadEvent>)`
  example, JS `new Channel<DownloadEvent>()` / `onEvent.onmessage`).
- **[D2]** Tauri v2 docs, "Calling Rust from the Frontend" — <https://v2.tauri.app/develop/calling-rust/>
  ("Async commands are executed on a separate async task using `async_runtime::spawn`";
  "The Tauri channel is the recommended mechanism for streaming data such as streamed HTTP
  responses to the frontend"; `Result` requirement for borrowed args; no cancellation section).
- **[D3]** Tauri v2 docs, "Inter-Process Communication" — <https://v2.tauri.app/concept/inter-process-communication/>
  (asynchronous message passing; commands are "JSON-RPC like", "all arguments and return data
  must be serializable to JSON"; events are "fire-and-forget, one-way IPC messages").
- **[D4]** docs.rs `tauri 2.11.2` `ipc::Channel` — <https://docs.rs/tauri/2.11.2/tauri/ipc/struct.Channel.html>
  (auto traits: `Send + Sync + Unpin + Freeze` when `TSend` is; `NamedType`/`Type` under `specta`).
- **[G1]** tauri PR #9070 "feat(ipc): preserve channel message order" (merged 2024-03-04) —
  <https://github.com/tauri-apps/tauri/pull/9070> (index counter + JS-side queue).
- **[G2]** tauri PR #10435 "Fix Specta remote implementation for `Channel`" (merged 2024-08-01,
  tauri 2.0.0-beta.26) — <https://github.com/tauri-apps/tauri/pull/10435>.
- **[G3]** tauri-specta issue #111 "Finish `Channel` support" (closed; blocked on #10435, asked
  to remove the feature gate and add docs) — <https://github.com/specta-rs/tauri-specta/issues/111>.
- **[G4]** tauri issue #8351 "[feat] AbortController support for `invoke` Promises" (open) —
  <https://github.com/tauri-apps/tauri/issues/8351>.
- **[G5]** tauri discussion #11915 "Performance: Tauri IPC vs React Native JSI" — FabianLars
  (maintainer): "~5ms on macOS but ~200ms on Windows" for 10 MB binary IPC; fetch-API-based IPC;
  shared memory only on WebView2 and "weirdly slow" — <https://github.com/orgs/tauri-apps/discussions/11915>.
- **[G6]** tauri discussion #6461 "Is there a memory limitation?" — webview subject to browser
  memory limits; everything over IPC is JSON-stringified (seen via search summary only) —
  <https://github.com/tauri-apps/tauri/discussions/6461>.
- **[M1]** Microsoft Q&A "Maximum script in CoreWebView2.ExecuteScriptAsync?" — answer: "no special
  limitation of the length of the script … I don't find related information in official doc" —
  <https://learn.microsoft.com/en-us/answers/questions/714727/maximum-script-in-corewebview2-executescriptasync>.
- **[M2]** MDN `String.length` — V8 max `2^29 - 24` (64-bit), SpiderMonkey `2^30 - 2`,
  JavaScriptCore `2^31 - 1` — <https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/String/length>.

## Unconfirmed

- Whether a builder that never calls `.events(...)` would emit a stray
  `export type TAURI_CHANNEL<TSend> = null` (the sid removal lives only in `events()`,
  [C10]). Irrelevant for Handshaker, which calls `.events(...)` after `.commands(...)`.
- The exact WebView2 transport for the fetch path (`http://ipc.localhost` custom scheme via
  `WebResourceRequested`) was not re-read in `tauri-2.11.2/src/ipc/protocol.rs`; the 8 KiB
  threshold and the "fetch" mechanism are confirmed from `channel.rs` comments [C1] and [G5].
- That dropping the tonic `Streaming` future on cancel sends `RST_STREAM` to the server is
  expected h2/tonic behaviour but was not verified against tonic sources in this ticket.
- The `≈5 ms vs ≈200 ms / 10 MB` figure is a maintainer-relayed, self-described
  "non-scientific" Discord benchmark [G5], not a Tauri benchmark; treat as order-of-magnitude.
- The M1 answer is from a Q&A forum, not the WebView2 reference; no official document states an
  `ExecuteScript` size limit either way.
- Memory growth under a slow webview (event-loop queue + `ChannelDataIpcQueue` +
  `pendingMessages`) is inferred from the code paths [C1][C5][C7]; not load-tested here.
- Issues surfaced by search but **not read**: tauri #9266 "ipc fallback issues", #10327 "IPC not
  responding … only when returning complex values", discussion #5690 "IPC Improvements".
