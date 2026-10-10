# Streaming

A server-streaming call shows a timeline instead of a single response body.
The end state that proves this works: the Messages tab lists one row per
pong, and the footer node `data-testid="stream-footer"` reads `OK` with a
message count (`1 msg` / `N msgs`). While the call is open the same footer
reads `STREAMING` (or `OPENING` before the first headers).

## Sub-features

- `test.Echo/ServerStream` — `▶ Send` once, then the server pushes `Pong` rows (`echoed` like `echo: <id> #1`).
- `test.Echo/ClientStream` and `test.Echo/Bidi` — the idle button is `▶ Open`. After open, the group `aria-label="Stream controls"` holds `Send message ▸`, `End stream`, and `Cancel`.
- Messages tab (search, and on two-way calls a direction group `aria-label` from the toolbar: All / Received / Sent).
- Headers and Trailers tabs. Contract tab when the method schema is loaded.
- Save messages / Assemble from the export menu once the call is terminal.

## How to get to it (user POV)

Start the echo server:

```sh
cargo run -p handshaker-core --example echo_server -- --port 50051 --count 3 --delay-ms 50
```

New request, address `127.0.0.1:50051`, TLS left on inherit (plaintext).
Pick `ServerStream` in the method dropdown. Click `▶ Send`. The response pane
switches to the stream timeline. Three messages arrive, then the footer
settles on `OK`.

For a bidi call, pick `Bidi`, click `▶ Open`, then `Send message ▸`, then
`End stream`. The direction chips appear because the call is two-way.

## Driving it with Tauri WebDriver

Use the same address and picker sequence as `unary-call.md`, with the method
name `ServerStream` instead of `Send`:

```sh
.cursor/skills/verify-handshaker/scripts/hsdrv.py click "xpath=//button[contains(@class,\"mp-mrow\")][.//span[contains(@class,\"mp-mname\") and text()=\"ServerStream\"]]"
.cursor/skills/verify-handshaker/scripts/hsdrv.py click "xpath=//button[contains(.,\"▶ Send\")]"
```

Poll the footer rather than sleeping a fixed time. `--delay-ms 50` and
`--count 3` finish well under the WebDriver script timeout:

```sh
.cursor/skills/verify-handshaker/scripts/hsdrv.py eval 'const el=document.querySelector("[data-testid=stream-footer]"); return el?el.innerText:""'
```

Done when that text contains `OK` and `3 msgs`. The Messages tab label is
`Messages`. A progress bar `data-testid="tab-progress"` is present only while
the 250ms busy gate says the call is still live; it is not the end state.

## Gotchas

- Server-streaming keeps the unary-looking `▶ Send` label. `▶ Open` means the method is client-streaming or bidi. The kind badge on the picked method reads `stream`, `client`, or `bidi`.
- `Send message ▸` and `End stream` stay disabled until the stream is open, and disable again after half-close. `Cancel` stays.
- The echo server's `--hang` flag never answers a client stream after half-close. Do not use it for a passing check.
- The timeline is virtualized in the page; assert on the footer count and one visible `echoed` preview, not on a pixel position.
- Save messages opens a native save dialog. The proof of the call is the footer and the rows, not that dialog.
