# Handshaker window features

The surface is the Tauri window. Drive it with the WebDriver session from
`../SKILL.md`. A fresh data directory opens on the Focus view of `workflow-1`,
with the env pill reading `No environment`, an empty main pane
(`No active request — pick a method in the sidebar.`), and one seeded
collection named `My Collection`.

| Feature | What proves it |
| --- | --- |
| [Collections](collections.md) | Sidebar rename field is `New collection`, and a new `collections/<id>.json` stores that name. Executed end to end by `scripts/drive-collections.sh`. |
| [Unary call](unary-call.md) | After Send to `test.Echo/Send` on the echo server, the response header reads `OK` and the body contains `echoed`. |
| [Environments](environments.md) | Create persists a named environment into `environments.json`, and the titlebar pill shows that name. |
| [Streaming](streaming.md) | Opening `test.Echo/ServerStream` fills the Messages timeline and the footer (`data-testid="stream-footer"`) ends on `OK`. |
| [Settings](settings.md) | The Settings dialog shows `Preferences persist locally` and the About pane shows the Cargo version. |
