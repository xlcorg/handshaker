# HTTP request

A plain HTTP request lives in the same Focus slot, collection file, environment,
and call history as a gRPC call. The end state that proves this works: Send
against a local echo returns `200` in `[data-testid="http-response-meta"]`
with an elapsed time and a byte size, the body shows the echo's JSON, the
sidebar row and a `history-row-open` button both reopen that request, and the
echo log shows the method that was selected.

## Sub-features

- Sidebar `+` menu item `aria-label="new-http-request"` (`New HTTP request`). Ctrl+N stays a gRPC draft.
- Address bar. Method menu button `aria-label="HTTP method"` (GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS). The open menu is `menuitemradio` rows on the popover surface. URL field `aria-label="Request URL"`. Send is `▶ Send`.
- Tabs Params, Headers, Body, Auth. Params and Headers reuse the metadata row inputs `metadata-key-<i>` / `metadata-value-<i>`.
- Body kind radios `role="radio"` named None, JSON, Text, Form (`aria-label="Body type"`). JSON and Text edit in a Monaco `textarea.inputarea`.
- Response meta `data-testid="http-response-meta"` (status, reason, elapsed, size). Body is pretty JSON. Headers is the other response tab. Idle copy is `Awaiting first request`.
- In-flight loading is the gRPC tab-strip comet (`data-testid="tab-progress"`, class `hs-tab-progress`) after the 250ms busy delay. The body stays empty while the request is in flight. There is no "Sending…" sentence.
- A saved HTTP row shows a short mono mark (GET, POST, PUT, PAT, DEL, HEAD, OPT) at 9px semibold, shifted 0.8px down so the ink sits in the middle of the name, left-aligned in a fixed column that starts at the folder-icon x for that depth. The column is 4ch, the width of POST, HEAD, and gRPC at that size. Colors match the method menu (GET green, POST amber, PUT blue, PATCH purple, DEL red, HEAD and OPT muted). The default gRPC mark is the word gRPC in that same column, in the gRPC blue, with the same 9px shift. A stored `solid`, `outline`, or `circle` pref still draws the icon. `off` keeps an empty column so names still share x. The name starts at one x per depth. The tooltip and accessible name keep the full method. History shows the full word at its own size.
- A 4xx/5xx stays a response (`404 Not Found`). DNS, TLS, and a refused connection are an error (`Service unavailable`).
- Save dialog. Name field `aria-label="Request name"`. The dialog's Save sits in the footer, separate from the toolbar button `aria-label="Save"`.
- History row `data-testid="history-row-open"`. An HTTP row reads the method, the status, the elapsed time, and the URL template.

## How to get to it (user POV)

Run an echo on `127.0.0.1:8765` that answers `GET` and `POST`, returns 404 for
`/missing`, and echoes method, path, query, content type, and body as JSON.
The drive used a one-file `ThreadingHTTPServer` for that.

Create an environment named `local` with variable `baseUrl` =
`http://127.0.0.1:8765` and leave that environment selected. The pill then
reads `local`.

Sidebar `+` → `New HTTP request`. URL `{{baseUrl}}/echo`. On Params, one row
`q` / `ping`. Send. The meta reads `200 OK` plus milliseconds and a byte
count, and the body contains `"method": "GET"` and the query.

Switch the method to POST, open Body, choose JSON, type `{"name":"ada"}`,
Send. The echo log line starts with `POST` and the meta is `200` with the
posted body inside the echo JSON. Save it as `Create user` under
`My Collection`. The collection file stores `"protocol": "http"` and
`"method": "POST"`.

`{{baseUrl}}/missing` returns `404 Not Found` in the meta.
`http://127.0.0.1:9/down` shows `Service unavailable` and
`Connection refused`. The history dock lists each of those calls. Clicking the
POST history row, and clicking `Create user` in the sidebar, restores method
POST, the URL template, and the JSON body without a new line in the echo log.

## Driving it with Tauri WebDriver

```sh
.cursor/skills/control-app/scripts/hsdrv.py click "[aria-label='new-item']"
.cursor/skills/control-app/scripts/hsdrv.py click "[aria-label='new-http-request']"
.cursor/skills/control-app/scripts/hsdrv.py eval 'const el=document.querySelector("[aria-label=\"Request URL\"]"); const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set; set.call(el,"{{baseUrl}}/echo"); el.dispatchEvent(new Event("input",{bubbles:true})); return el.value'
```

The method control is a menu button. Open it, then click the radio row:

```sh
.cursor/skills/control-app/scripts/hsdrv.py click "[aria-label='HTTP method']"
.cursor/skills/control-app/scripts/hsdrv.py click "xpath=//div[@role='menuitemradio'][normalize-space()='POST']"
.cursor/skills/control-app/scripts/hsdrv.py click "xpath=//button[normalize-space()=\"Body\"]"
.cursor/skills/control-app/scripts/hsdrv.py click "xpath=//button[@role=\"radio\" and normalize-space()=\"JSON\"]"
.cursor/skills/control-app/scripts/hsdrv.py eval 'const ta=document.querySelector("textarea.inputarea"); ta.focus(); return document.execCommand("insertText", false, "{\"name\":\"ada\"}")'
.cursor/skills/control-app/scripts/hsdrv.py click "xpath=//button[normalize-space()=\"▶ Send\"]"
```

After Send, `[data-testid="http-response-meta"]` contains `200`. Reopen from
history and from the sidebar:

```sh
.cursor/skills/control-app/scripts/hsdrv.py click "xpath=//button[@data-testid=\"history-row-open\"][contains(.,\"POST\")]"
.cursor/skills/control-app/scripts/hsdrv.py click "xpath=//div[@data-node-id][.//span[normalize-space()=\"Create user\"]]"
```

The environment value cell is a `textarea` (placeholder `value`), disabled
until that row's key is non-empty. Edit an existing environment with
`aria-label="Edit local"`, set the enabled textarea, and press the dialog
`Save`. Query rows are `metadata-key-0` and `metadata-value-0` on the Params
tab, which is the default tab.

## Gotchas

- The method control is a menu, not a `<select>`. Setting a select value does nothing. Click `[aria-label='HTTP method']`, then the `menuitemradio` whose text is the method.
- `document` model `setValue` on the Monaco editor does not notify the draft. `execCommand("insertText")` after focusing `textarea.inputarea` does. Two `inputarea` nodes can exist once a response is showing. The request editor is the first.
- A dirty unsaved HTTP draft opens `Discard unsaved request?` before another request replaces it. `Cancel` stays on the draft.
- The toolbar Save is `aria-label="Save"`. The dialog confirm is the `Save` button inside the footer (`sm:justify-end`), and clicking the first `Save` in the DOM hits the toolbar behind the dialog.
- An empty environment variable turns `{{baseUrl}}/echo` into `/echo`, and Send reports `Invalid URL: start it with http:// or https://`. The resolved preview is drawn next to the template, so `innerText` looks like a doubled path.
- 4xx is a response value. Connection refused is the client error view titled `Service unavailable`.
