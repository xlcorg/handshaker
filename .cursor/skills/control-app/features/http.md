# HTTP request

A plain HTTP request lives in the same Focus slot, collection file, environment,
and call history as a gRPC call. The end state that proves this works: Send
against a local echo returns `200` in `[data-testid="http-response-meta"]`
with an elapsed time and a byte size, the body shows the echo's JSON, the
sidebar row and a `history-row-open` button both reopen that request, and the
echo log shows the method, path, query, headers, and body that arrived.

Auth and environment substitution are part of that proof. The reproducible
drive is `scripts/drive-http.py` against `scripts/http-echo.py`.

## Sub-features

- Sidebar `+` menu item `aria-label="new-http-request"` (`New HTTP request`). Ctrl+N stays a gRPC draft.
- Address bar. Method menu button `aria-label="HTTP method"` (GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS). The open menu is `menuitemradio` rows on the popover surface. URL field `aria-label="Request URL"`. Send is `▶ Send`.
- Tabs Params, Headers, Body, Auth. Params and Headers reuse the metadata row inputs `metadata-key-<i>` / `metadata-value-<i>`. An empty template has no row until `[aria-label='add metadata row']`.
- Body kind radios `role="radio"` named None, JSON, Text, Form (`aria-label="Body type"`). JSON and Text edit in a Monaco `textarea.inputarea`.
- Response meta `data-testid="http-response-meta"` (status, reason, elapsed, size). Body is pretty JSON. Headers is the other response tab. Idle copy is `Awaiting first request`.
- In-flight loading is the gRPC tab-strip comet (`data-testid="tab-progress"`, class `hs-tab-progress`) after the 250ms busy delay. The body stays empty while the request is in flight. There is no "Sending…" sentence.
- A saved HTTP row shows a short mono mark (GET, POST, PUT, PAT, DEL, HEAD, OPT) at 9px semibold, shifted 0.8px down so the ink sits in the middle of the name, left-aligned in a fixed column that starts at the folder-icon x for that depth. The column is 4ch, the width of POST, HEAD, and gRPC at that size. Colors match the method menu (GET green, POST amber, PUT blue, PATCH purple, DEL red, HEAD and OPT muted). A gRPC row shows the word gRPC in that same column, in the gRPC blue, with the same 9px shift. There is no icon-style setting. A stored grpcIcon value is ignored, and the word is still shown. The name starts at one x per depth. The tooltip and accessible name keep the full method. History shows the full word at its own size.
- A 4xx/5xx stays a response (`404 Not Found`). A refused connection is `Service unavailable`. A TLS failure is `TLS handshake failed`. A DNS failure is `Host not found`. A missing `{{var}}` fails before the network (`Unresolved variables: {{name}}`, title `Request failed`). `drive-http.py` asserts the refused title. The imported-collection sends in `drive-transfer.py` cover methods, bodies, auth, and `{{var}}` substitution.
- Save dialog. Name field `aria-label="Request name"`. The dialog's Save sits in the footer, separate from the toolbar button `aria-label="Save"`.
- History row `data-testid="history-row-open"`. An HTTP row reads the method, the status, the elapsed time, and the URL template.

## Auth types the app actually has

The HTTP Auth tab is read-only (`AuthReadOnly`). Configuration is the collection overview → Authorization tab (`SavedAuthEditor`), persisted immediately by `collectionSetNodeAuth`. The wire enum is `SavedAuthConfig` (`crates/handshaker-core/src/auth/mod.rs`, mirrored as `SavedAuthConfigIpc`):

| UI toggle (`aria-label`) | Stored `kind` | What the echo receives |
| --- | --- | --- |
| `None` | `none` | No `authorization` header and no `x-api-key` header. |
| `Bearer` | `env_var` | Header `authorization: Bearer <secret>`. The field (placeholder `BEARER_TOKEN_VAR`) is the **OS environment variable name**, not a `{{var}}`. Default header name `authorization`, prefix `Bearer ` (trailing space). |
| `API key` | `env_var` | Header `{header}: {prefix}{secret}`. Empty header name becomes `x-api-key`. The value field (placeholder `API_KEY_VAR`) is the OS variable name. The prefix can be empty. There is no query-string API key. |
| `OAuth2` | `oauth2_client_credentials` | The only grant. POST `token_url` as `application/x-www-form-urlencoded` with `grant_type=client_credentials`, `client_id`, `client_secret`, and `scope`. The next request sends `authorization: Bearer <access_token>`. Token URL, client id, client secret, and scope are `{{var}}` templates. The OAuth header name and prefix are not substituted. |

Not implemented, so they are not checks: HTTP Basic, API key in the query string, authorization-code, PKCE, digest, SigV4.

Collection auth applies only after the request is saved (`setDraftOrigin` stamps `collectionId`). An unsaved draft has `collectionId: null`. A saved request stores `auth: { kind: "none" }`. `pick_auth_config` skips `SavedAuthConfig::None` and falls through to the collection, so request-level `none` does not block collection auth. The overview copy says a request can override collection auth; the HTTP editor has no place to set request auth.

The Auth tab sentence `Auth is inherited from the service (configured in the service panel).` (`messages.ts` `authInherited`) is wrong for HTTP. The live drive still sees that sentence. Configuration is the collection Authorization tab.

OAuth2 tokens are cached for the process. The cache key is token URL + client id + client secret + scopes. A second send with the same credentials does not POST `/token` again; the echo still receives `authorization: Bearer <access_token>`. Switching the active environment to different credentials does POST a new token.

## Environment substitution

Active environment variables override collection variables (`substitute_once` in `crates/handshaker-core/src/vars/mod.rs`). HTTP `prepare` substitutes, then expands builtins, then parses the URL, then materializes auth.

Substituted:

- URL, including the path (`{{baseUrl}}/{{pathSeg}}` → `http://127.0.0.1:8765/echo`)
- query keys and query values
- header **values** (reqwest lowercases the name on the wire: `X-Env` arrives as `x-env`)
- JSON, text, and form bodies
- OAuth2 token URL, client id, client secret, and scopes

Not substituted:

- header names (the editor stores them literally; the wire name is the lowercased form)
- Bearer and API key OS variable **names**
- OAuth2 header name and prefix

Missing variable: the placeholder stays literal and Send fails before any socket with `Unresolved variables: {{name}}`. The echo log does not grow.

Defined empty string: the placeholder becomes empty. `{{blank}}/echo` with `blank=""` becomes `/echo`, and Send reports `Invalid URL: start it with http:// or https://`. The echo log does not grow.

Switching the active environment changes the next send: query, header value, body, and OAuth2 credentials all follow the new environment.

## How to get to it (user POV)

Start the echo, then the app with the OS secrets Bearer and API key will read:

```sh
.cursor/skills/control-app/scripts/http-echo.py
HS_BEARER=BearerSecret HS_APIKEY=KeySecret \
  .cursor/skills/control-app/scripts/launch.sh
.cursor/skills/control-app/scripts/doctor.sh
.cursor/skills/control-app/scripts/drive-http.py
```

`http-echo.py` listens on `127.0.0.1:8765` (`HTTP_ECHO_PORT`). It appends one JSON object per request to `/tmp/handshaker-verify/http-echo.jsonl` (`HTTP_ECHO_LOG`), returns 404 text `missing` for `/missing`, and for `POST /token` returns `{"access_token":"tok-<client_id>","expires_in":3600,"token_type":"Bearer"}`. Every other path returns 200 JSON echoing method, path, query, headers, and body. The log is truncated when the echo starts.

`drive-http.py` assumes that session is already healthy and the echo is already listening. It creates environments `other` and `local` (skipped when `environments.json` already contains the name), activates `local`, and drives one saved POST named `Echo probe` under `My Collection`.

`local` / `other` variables:

| Key | `local` | `other` |
| --- | --- | --- |
| `baseUrl` | `http://127.0.0.1:8765` | `http://127.0.0.1:8765` |
| `pathSeg` | `echo` | `echo` |
| `qKey` / `qVal` | `q` / `from-local` | `q` / `from-other` |
| `hdr` | `alpha` | `beta` |
| `bodyVal` | `ada` | `bea` |
| `oauthId` / `oauthSecret` / `oauthScope` | `id-local` / `sec-local` / `scope.local` | `id-other` / `sec-other` / `scope.other` |
| `blank` | empty string | empty string |

The script asserts, in order, against the echo log and the window:

1. Unsaved `GET {{baseUrl}}/echo?q=ping` → 200, query `q=ping`, no auth headers.
2. `{{baseUrl}}/missing` → meta contains `404` and `Not Found`.
3. `http://127.0.0.1:9/down` → `Service unavailable` and `Connection refused`, and the log does not grow.
4. Saved POST `{{baseUrl}}/{{pathSeg}}` with query `{{qKey}}={{qVal}}`, header `X-Env: {{hdr}}`, JSON body `{"item":"{{bodyVal}}"}`, collection auth `None` → `POST /echo`, query `q=from-local`, `x-env: alpha`, body contains `ada`, no auth headers.
5. Bearer (`HS_BEARER`) → `authorization: Bearer BearerSecret`.
6. API key header `x-api-key`, empty prefix (`HS_APIKEY`) → `x-api-key: KeySecret` and no `authorization`.
7. OAuth2 templates `{{baseUrl}}/token`, `{{oauthId}}`, `{{oauthSecret}}`, `{{oauthScope}}`. When `/token` is hit, the form is `grant_type=client_credentials&client_id=id-local&client_secret=sec-local&scope=scope.local`. The echo request is `authorization: Bearer tok-id-local`. A cache hit prints `oauth used the process token cache` and still checks that header.
8. Switch the pill to `other` → query `q=from-other`, `x-env: beta`, body contains `bea`, `authorization: Bearer tok-id-other`. A new token POST uses `id-other` / `sec-other` / `scope.other`.
9. `None` again → 200, no auth headers, still `other`'s query and body.
10. URL `{{noSuchVar}}` → `Unresolved variables: {{noSuchVar}}`, log unchanged.
11. URL `{{blank}}/echo` → `Invalid URL: start it with http:// or https://`, log unchanged.
12. Restore the template. The first history row `POST` + `200`, and the sidebar row `Echo probe`, reopen the URL `{{baseUrl}}/{{pathSeg}}` without a new echo line.

Screenshots land in the run's `evidence/` directory and are copied to `/opt/cursor/artifacts/`: `http-get-200`, `http-refused`, `http-auth-none`, `http-auth-bearer`, `http-auth-apikey`, `http-auth-oauth2`, `http-env-local`, `http-env-switched-pill`, `http-env-other`, `http-env-missing`, `http-env-empty`, `http-reopen`. A failed run also writes `http-failure`.

The same steps by hand, after `local` exists and is selected:

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
.cursor/skills/control-app/scripts/hsdrv.py click "xpath=//div[@data-node-id][.//span[normalize-space()=\"Echo probe\"]]"
```

Collection auth, after the request is saved under `My Collection`. Open the overview, then the Authorization tab, then the toggle. Bearer and API key fields are placeholders, not aria-labels. OAuth2 fields are `aria-label="Token URL"`, `Client ID`, `Client secret`, and `Scope`.

```sh
.cursor/skills/control-app/scripts/hsdrv.py click "xpath=//div[@data-node-id][.//span[normalize-space()=\"My Collection\"]]//button[@aria-label=\"open-collection\"]"
.cursor/skills/control-app/scripts/hsdrv.py click "xpath=//button[normalize-space()=\"Authorization\"]"
.cursor/skills/control-app/scripts/hsdrv.py click "[aria-label='Bearer']"
```

The environment editor is the two-pane dialog in `environments.md`. Add a
variable with `data-field="add"`, type into `aria-label="Variable name"`
(placeholder `VARIABLE_NAME`) and `textarea[aria-label="Value"]`, then commit
with the icon `aria-label="Add variable"`. `Create` leaves the dialog open;
`Done` closes it. Edit an existing environment with `aria-label="Edit local"`.
There is no dialog `Save` button; edits save on their own. Query rows are
`metadata-key-0` and `metadata-value-0` on the Params tab, which is the
default tab. The env pill is the second titlebar button whose label uses
`max-w-[180px]` (the first is the workflow name). A Radix menu needs the
WebDriver pointer click, not `element.click()`:

```sh
.cursor/skills/control-app/scripts/hsdrv.py click 'xpath=(//button[.//span[contains(@class,"max-w-[180px]")]])[2]'
.cursor/skills/control-app/scripts/hsdrv.py click 'xpath=//*[@data-env-row="local"]//*[@role="menuitem"]'
```

Saved HTTP items in the collection JSON are flattened (`protocol`, `method`,
`url_template` on the item), not nested under `template`.

## Gotchas

- The method control is a menu, not a `<select>`. Setting a select value does nothing. Click `[aria-label='HTTP method']`, then the `menuitemradio` whose text is the method.
- `document` model `setValue` on the Monaco editor does not notify the draft. `execCommand("insertText")` after focusing `textarea.inputarea` does. The view-lines node can still be empty in that same turn; poll it. Two `inputarea` nodes can exist once a response is showing. The request editor is the first. `hsdrv.py eval` JSON-decodes a returned string that is itself JSON, so wrap a Monaco readout as `JSON.stringify({shown})`.
- A dirty unsaved HTTP draft opens `Discard unsaved request?` before another request replaces it. `Cancel` stays on the draft. Buttons are `Cancel`, `Save…`, and `Discard`.
- The toolbar Save is `aria-label="Save"`. The dialog confirm is the `Save` button inside the footer (`sm:justify-end`), and clicking the first `Save` in the DOM hits the toolbar behind the dialog.
- An empty environment variable turns `{{baseUrl}}/echo` into `/echo`, and Send reports `Invalid URL: start it with http:// or https://`. The resolved preview is drawn next to the template, so `innerText` looks like a doubled path.
- 4xx is a response value. Connection refused is the client error view titled `Service unavailable`.
- `Done` closes the environment editor. On the current build that close left the body clickable. `drive-http.py` still clears `pointer-events: none` and `data-scroll-locked` if a close sets them, and prints `BUG scroll-lock stuck` when it does. See `environments.md`.
- `hsdrv.py launch` forwards `HS_BEARER` and `HS_APIKEY` into the app process only when they are set in the shell that runs `launch.sh`. A tmux `env` prefix does not inherit the rest of the parent environment. Confirm with `/proc/<appPid>/environ` from `session.json`.
