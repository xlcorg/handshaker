# Call history

Every Focus call that reaches the wire leaves one row in the History dock at
the bottom of the main column, newest first. The end state that proves this
works: after a unary Send to `test.Echo/Send`, the first
`[data-testid="history-row-open"]` button reads `Echo.Send` and `OK`, and
`$XDG_DATA_HOME/dev.handshaker.app/history/` holds one `<uuid>.json` per row
plus `index.json`.

## Sub-features

- Header strip. `[data-testid="history-dock-toggle"]` reads `History · N` and carries `aria-expanded`. The dock starts expanded. Collapsed, only this strip stays.
- Filter `[data-testid="history-filter"]` (placeholder `Filter by service, method, address or status`) matches service, method, address and status text.
- Chips `history-chip-all`, `history-chip-ok`, `history-chip-failed` in the group `aria-label="Show calls"`, each with `aria-pressed`. OK is status 0 only. Failed is a non-zero status, a fault, or a cancel.
- Rows. Columns are Time, Method, Status, Elapsed, Address. `history-row-open` is the row's native button. `history-row-rerun` is the icon button at its right edge.
- Detail `[data-testid="history-detail"]` follows the focused row. It shows Request, Metadata (enabled rows only), Response or Messages, Headers, Trailers, and `history-detail-rerun`.

## How to get to it (user POV)

Start the echo server as in `unary-call.md`. Send `test.Echo/Send` once. A row
appears at the top of the dock. Click it. Focus loads that request with the
method selected and does not send. Click the row's re-run icon. Focus loads it
and sends once, and a second row appears on top.

## Driving it with Tauri WebDriver

Drive a unary Send exactly as `unary-call.md` does, then read the dock:

```sh
.cursor/skills/control-app/scripts/hsdrv.py eval 'return document.querySelectorAll("[data-testid=history-row-open]").length'
.cursor/skills/control-app/scripts/hsdrv.py eval 'return document.querySelector("[data-testid=history-row-open]").innerText'
.cursor/skills/control-app/scripts/hsdrv.py screenshot history-unary
```

Done when the count went up by one and the first row's text contains
`Echo.Send` and `OK`.

A non-OK call. Restart the echo server with `--status 5` and Send again. The
first row reads `NOT_FOUND`. A refused call. Set the address to
`127.0.0.1:50059` (nothing listens there) and Send. The first row reads
`Service unavailable`, and its detail shows the fault face.

A server stream. Drive `ServerStream` as `streaming.md` does and wait for the
footer to read `OK`. The first row reads `Echo.ServerStream` with the `stream`
badge. Focus it and count the recorded messages:

```sh
.cursor/skills/control-app/scripts/hsdrv.py eval 'document.querySelector("[data-testid=history-row-open]").focus(); return true'
.cursor/skills/control-app/scripts/hsdrv.py eval 'return document.querySelectorAll("[data-testid=history-detail] [data-testid=history-message]").length'
```

Filter and chips. The filter is a controlled input. Set it with the native
value setter and an input event:

```sh
.cursor/skills/control-app/scripts/hsdrv.py eval 'const el=document.querySelector("[data-testid=history-filter]"); const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set; set.call(el,"ServerStream"); el.dispatchEvent(new Event("input",{bubbles:true})); return document.querySelectorAll("[data-testid=history-row-open]").length'
.cursor/skills/control-app/scripts/hsdrv.py click "[data-testid='history-chip-failed']"
.cursor/skills/control-app/scripts/hsdrv.py eval 'return [...document.querySelectorAll("[data-testid=history-row-open]")].map(b=>b.innerText)'
```

Clear the filter the same way with `""` and click `history-chip-all` before
the next step.

Open a row into Focus. Clicking it must not send, so the row count stays put:

```sh
.cursor/skills/control-app/scripts/hsdrv.py click "[data-testid='history-row-open']"
.cursor/skills/control-app/scripts/hsdrv.py eval 'return document.querySelector("[aria-label=draft-address]").value'
.cursor/skills/control-app/scripts/hsdrv.py eval 'return document.querySelectorAll("[data-testid=history-row-open]").length'
```

Re-run. Poll the count until it goes up by one:

```sh
.cursor/skills/control-app/scripts/hsdrv.py click "[data-testid='history-row-rerun']"
.cursor/skills/control-app/scripts/hsdrv.py eval 'return document.querySelectorAll("[data-testid=history-row-open]").length'
.cursor/skills/control-app/scripts/hsdrv.py screenshot history-rerun
```

Persistence. The rows live on disk under the run's data dir. List them, then
reload the webview so the dock hydrates again from `history_list`:

```sh
ls "$(readlink -f /tmp/handshaker-verify/current)/xdg/dev.handshaker.app/history"
.cursor/skills/control-app/scripts/hsdrv.py eval 'location.reload(); return true'
.cursor/skills/control-app/scripts/hsdrv.py eval 'return document.querySelectorAll("[data-testid=history-row-open]").length'
```

The count after the reload equals the count before it. A reload keeps the
backend process. A cold restart copies that app-data directory and launches
again with `HANDSHAKER_SEED_DATA` set to it. `launch.sh` still creates a fresh
run directory, then copies the seed in before the binary starts. The dock
comes back with the same rows, and `history/index.json` is unchanged.

## Gotchas

- Rows are newest first. Assert on the first row, not on a position you computed.
- Click `history-row-open`, not its `li`. The `li` has no handler.
- Opening a row over a dirty unsaved draft shows the discard dialog first. Nothing loads until Discard or Save.
- Only Focus calls are recorded. A Send from List or Ledger leaves no row.
- A cancel before the stream opened leaves no row. A cancel after Open reads `Cancelled`.
- The top few pixels of the header strip belong to the resize handle above it. Click controls by selector, which hits their center.
- The dock keeps 200 calls. The oldest body file is deleted when a 201st lands.
