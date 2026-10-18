# Handshaker window features

The surface is the Tauri window. Drive it with the WebDriver session from
`../SKILL.md`. A fresh data directory opens on the Focus view of `workflow-1`,
with the env pill reading `No environment`, an empty main pane
(`No active request — pick a method in the sidebar.`), and one seeded
collection named `My Collection`.

| Feature | What proves it |
| --- | --- |
| [Collections](collections.md) | Sidebar rename field is `New collection`, and a new `collections/<id>.json` stores that name (`scripts/drive-collections.sh`). Export and import of `handshaker-export` round-trips and the imported HTTP rows send (`scripts/drive-transfer.py`). |
| [Unary call](unary-call.md) | After Send to `test.Echo/Send` on the echo server, the response header reads `OK` and the body contains `echoed`. |
| [Environments](environments.md) | Create persists a named environment into `environments.json`, and the titlebar pill shows that name. The editor is a left list plus a variable pane: default sort `Oldest first`, `VARIABLE` header toggles name order, and `Done` closes it. |
| [Streaming](streaming.md) | Opening `test.Echo/ServerStream` fills the Messages timeline and the footer (`data-testid="stream-footer"`) ends on `OK`. |
| [Settings](settings.md) | The Settings dialog shows `Preferences persist locally` and the About pane shows the Cargo version. |
| [Recent switcher](recent-switcher.md) | Ctrl+Tab shows a list named `Recently opened`. Releasing Ctrl opens the highlighted row. |
| [Call history](call-history.md) | After a unary Send, the first `history-row-open` button reads `Echo.Send` and `OK`, and the run's `history/` dir holds that call's `<uuid>.json`. |
| [HTTP request](http.md) | `scripts/http-echo.py` and `scripts/drive-http.py` send GET and POST to a local echo. The meta reads `200`, a 404 stays a response, a refused port shows `Service unavailable`, and the saved row plus a `history-row-open` button reopen the POST without a new echo line. The same drive asserts none, Bearer, API key header, and OAuth2 client-credentials on the echo log, then checks environment substitution and an active-environment switch. |
