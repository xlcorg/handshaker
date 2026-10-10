---
name: verify-handshaker
description: >-
  Drive the Handshaker desktop gRPC client (Tauri window, Linux WebKitGTK
  via tauri-driver). Use when checking that the real window starts, or when
  verifying collections, a unary call, environments, a streaming RPC, or
  settings against the running app.
---

# Verify Handshaker

Handshaker's user-facing surface is the Tauri desktop window (React inside the
web view). The frontend never calls gRPC itself; buttons go through Tauri IPC
into `handshaker-core`. Vitest (`pnpm test`) renders components in jsdom and
does not open this window. Drive the window with Tauri's WebDriver:
`tauri-driver` 2.0.5 in front of `/usr/bin/WebKitWebDriver`.

This path was run on Linux (WebKitGTK 2.52, `DISPLAY=:1`). The repo README
still lists macOS and Windows as the product hosts. Do not invent a driver
binary for those hosts from this file. The documented interactive loop on
every host is `pnpm tauri:dev` (Vite on `http://localhost:1420`,
`strictPort: true` in `vite.config.ts`). That loop is not the drive harness:
`tauri-driver` has to spawn the binary itself, and a second `tauri dev`
cannot bind 1420 while the first holds it.

Two debug binaries can run side by side. Each `launch.sh` picks its own
WebDriver ports (starting at 4444/4445), its own tmux session, and its own
`XDG_DATA_HOME`. The app identifier is `dev.handshaker.app`
(`src-tauri/tauri.conf.json`), so the files land in
`$XDG_DATA_HOME/dev.handshaker.app/`. Two launches were observed at once,
each with its own `collections/*.json`. Sharing the default
`~/.local/share/dev.handshaker.app` makes them race on those files.

## Launch

Build once, from the repo root:

```sh
pnpm install
pnpm build          # writes dist/; the binary loads it at tauri://localhost
cargo build -p handshaker
```

The binary is `target/debug/handshaker` (workspace `target/`, not
`src-tauri/target/`). Compiling on Linux needs WebKitGTK 4.1 dev libraries.
Driving needs the `webkit2gtk-driver` package (`/usr/bin/WebKitWebDriver`) and
`tauri-driver`:

```sh
cargo install tauri-driver --locked --version 2.0.5
```

`DISPLAY` must be set. Start a session:

```sh
.cursor/skills/verify-handshaker/scripts/launch.sh
```

The script exports `WEBKIT_DISABLE_COMPOSITING_MODE=1`, `GDK_BACKEND=x11`,
and `LIBGL_ALWAYS_SOFTWARE=1`, puts `node_modules/.bin` on `PATH`, and points
`XDG_DATA_HOME`, `XDG_CONFIG_HOME`, and `XDG_CACHE_HOME` at the run directory.
A debug build runs `prettier --write` on startup (`src-tauri/src/lib.rs`,
`#[cfg(debug_assertions)]`). If `prettier` is not on `PATH`, that export
panics before the window exists. The same export overwrites the tracked file
`src/ipc/bindings.ts`. Launch snapshots it first.

Readiness is a stdout line:

```text
ready run=/tmp/handshaker-verify/<stamp>-<pid> session=<id> data=... title=Handshaker filter=yes splash=no
```

That line is printed only after the WebDriver title is `Handshaker`, the URL
is `tauri://localhost`, `#splash` is gone, and
`[aria-label="collection-filter"]` is in the DOM. A fresh data directory also
seeds a collection named `My Collection`
(`src/features/catalog/useCatalogTree.ts`) and the main pane reads
`No active request — pick a method in the sidebar.`

The latest run is symlinked from `/tmp/handshaker-verify/current`. Point
`HANDSHAKER_VERIFY_RUN` at a run directory to target an older one.

Teardown is the Cleanup section. Run `cleanup.sh` when the drive is finished.
It does not run on success by itself.

## Doctor

With the launch still up:

```sh
.cursor/skills/verify-handshaker/scripts/doctor.sh
```

Read-only. It reads the WebDriver title and URL and evaluates a script that
reports whether `#splash` and the collection filter exist, plus
`document.body.innerText`. It clicks nothing and writes nothing. It passes
when the title is `Handshaker`, the URL starts with `tauri://`, the splash
node is gone, the filter is present, the sidebar text contains `COLLECTIONS`,
and the corner badge contains `v` plus `package.json`'s `version` (the badge
is `v0.2.35` at the time this was written). The last line is `ok`.

## Drive

Helpers speak W3C WebDriver to the recorded session. Prefer CSS selectors and
ARIA labels. `xpath=` is the prefix when the control has no label (the env
pill, a method row).

```sh
.cursor/skills/verify-handshaker/scripts/hsdrv.py click "[aria-label='Settings']"
.cursor/skills/verify-handshaker/scripts/hsdrv.py eval 'return document.body.innerText'
.cursor/skills/verify-handshaker/scripts/hsdrv.py text
.cursor/skills/verify-handshaker/scripts/hsdrv.py click "xpath=//button[contains(@class,'mp-mrow')][.//span[contains(@class,'mp-mname') and text()='Send']]"
```

The mapped flow that was executed end to end is the sidebar's New collection
action:

```sh
.cursor/skills/verify-handshaker/scripts/drive-collections.sh
```

It clicks `[aria-label="new-item"]`, then `[aria-label="new-collection"]`,
waits until `[aria-label="rename-input"]` has value `New collection`, and
checks that `$XDG_DATA_HOME/dev.handshaker.app/collections/<id>.json` is a new
file whose `data.name` is `New collection`. The id comes from the row's
`data-node-id`. Per-feature steps for the other surfaces are under
`features/`.

## Evidence

`drive-collections.sh` writes into the run's `evidence/` directory (printed
as `evidence: /tmp/handshaker-verify/<run>/evidence`):

- `collections-new.png` — window after the create click
- `collections-dom.txt` — `innerText` at that moment
- `new-collection.json` — copy of the file the app wrote
- `result.json` — rename-input value, collection id, and the live path

The live file stays in the run's data dir. That write is the real collection
store (`crates/handshaker-core/src/collections/file_store.rs`), not a mock.
Do not point the app at a stand-in IPC layer. The echo server used by the
unary and streaming notes is the real example binary, and only when that
feature is the one being driven.

Save the window at any step. `<name>` is one file name. A missing `.png`
suffix is added. The PNG lands in that run's `evidence/` directory, and
Cleanup leaves the directory in place.

```sh
.cursor/skills/verify-handshaker/scripts/hsdrv.py screenshot <name>
```

## Cleanup

```sh
.cursor/skills/verify-handshaker/scripts/cleanup.sh
```

Reads `session.json` for that run and:

1. `DELETE`s that WebDriver session (this is what quits the window).
2. Signals the recorded `appPids` and `driverPid` only, and only when
   `/proc/<pid>/cmdline` still contains the binary path or `tauri-driver`.
   A recycled pid is skipped.
3. `tmux kill-session` for the session name this launch created.
4. Copies `src/ipc/bindings.ts` back from the pre-launch snapshot when the
   file was clean in git before launch. If it was already dirty, it is left
   alone.

It does not delete the run directory. Evidence stays under
`/tmp/handshaker-verify/<run>/evidence`. If a drive fails, run cleanup before
the next launch so the recorded processes are released; anything already
written under `evidence/` remains.

## Helpers

| Script | Invocation |
| --- | --- |
| `scripts/launch.sh` | `.cursor/skills/verify-handshaker/scripts/launch.sh` |
| `scripts/doctor.sh` | `.cursor/skills/verify-handshaker/scripts/doctor.sh` |
| `scripts/drive-collections.sh` | `.cursor/skills/verify-handshaker/scripts/drive-collections.sh` |
| `scripts/cleanup.sh` | `.cursor/skills/verify-handshaker/scripts/cleanup.sh` |
| `scripts/hsdrv.py` | `.cursor/skills/verify-handshaker/scripts/hsdrv.py click "<selector>"` |
| `scripts/hsdrv.py` | `.cursor/skills/verify-handshaker/scripts/hsdrv.py eval '<javascript that returns a value>'` |
| `scripts/hsdrv.py` | `.cursor/skills/verify-handshaker/scripts/hsdrv.py text` |
| `scripts/hsdrv.py` | `.cursor/skills/verify-handshaker/scripts/hsdrv.py screenshot <name>` |

All five files are executable. `hsdrv.py` is the implementation; the shell
scripts call it.
