# Settings

Opening Settings shows the local preferences dialog. The end state that
proves this works: the dialog heading is `Settings`, the subtitle is
`Preferences persist locally. Restart not required.`, and the default
Appearance section shows the row `Zoom`, and does not show `gRPC icon`. The
About section's version line equals the `version` field in `package.json`
and in `src-tauri/Cargo.toml`.

## Sub-features

- Appearance — zoom (`aria-label="Zoom in"`, `Zoom out`, and `Reset zoom` only when the factor is not 1), sidebar, split direction, word wrap, method-picker group style (`aria-label="method-list-style"`), variable highlight (`aria-label="var-highlight-scheme"`). At 100% the Appearance pane has no Reset button.
- History — `Confirm before clearing` (`aria-label="Confirm before clearing"`). On by default. Off makes Clear history delete the log on the first click. The value is `confirmClearHistory` in `handshaker.prefs.v1`.
- Network — request deadline and max message size.
- Keyboard — shortcut list.
- Import / Export — the same `handshaker-export` bundle as the sidebar. Buttons are `Export` and `Import` inside the dialog, with no aria-label. `scripts/drive-transfer.py` drives both. The file picker is a native dialog. See `collections.md` for the format, the merge, and the fetch stub.
- About — version, runtime `tauri 2 · react 18`, and Check for updates.

## How to get to it (user POV)

The gear button is at the right of the titlebar, before the window buttons.
Its tooltip and accessible name are `Settings`. The dialog opens on
Appearance. The left rail is Appearance, History, Network, Keyboard, Import / Export,
About. Close it with Escape. The window-chrome buttons on Linux are
`aria-label="Minimize window"`, `Maximize window`, and `Close window`.
Minimize and close are real window operations; do not click Close during a
drive unless you mean to end the session.

## Driving it with Tauri WebDriver

```sh
.cursor/skills/control-app/scripts/hsdrv.py screenshot settings-before
.cursor/skills/control-app/scripts/hsdrv.py click "[aria-label='Settings']"
.cursor/skills/control-app/scripts/hsdrv.py screenshot settings-appearance
.cursor/skills/control-app/scripts/hsdrv.py eval 'return document.body.innerText.includes("Preferences persist locally") && document.body.innerText.includes("Zoom") && !document.body.innerText.includes("gRPC icon")'
.cursor/skills/control-app/scripts/hsdrv.py click "xpath=//button[normalize-space()=\"About\"]"
.cursor/skills/control-app/scripts/hsdrv.py screenshot settings-about
.cursor/skills/control-app/scripts/hsdrv.py eval 'return document.body.innerText.includes("tauri 2")'
```

Poll the About version until it equals `package.json` `version`. The line
renders `version 0.0.0` until `ipc.appVersion()` resolves. A check for the
word `version` matches that placeholder.

Escape closes the dialog. Read the subtitle in a later command. The eval that dispatches Escape can still see `Preferences persist locally`.

```sh
.cursor/skills/control-app/scripts/hsdrv.py eval 'document.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true})); return true'
.cursor/skills/control-app/scripts/hsdrv.py eval 'return document.body.innerText.includes("Preferences persist locally")'
.cursor/skills/control-app/scripts/hsdrv.py screenshot settings-closed
```

After a real close the second expression is false. Appearance toggles persist in
`localStorage` key `handshaker.prefs.v1` inside the web view profile (under
the run's data dir, `localstorage/tauri_localhost_0.localstorage`). The
Collection links row in Appearance is the exception: Strip / Header writes
`links_placement` in `ui-state.json`. That file also holds the collection
sort key and the active request.

## Gotchas

- Check for updates hits the GitHub latest-release endpoint configured in
  `src-tauri/tauri.conf.json`. A drive of About should read the version text
  and not click `Check for updates` unless the network is meant to be part of
  the check. The button's accessible name on the titlebar is `Check for updates`.
- Zoom buttons call `setPref("zoom", ...)`. `useUiZoom` applies `webview.setZoom` in an effect. The percentage label follows the pref. `Reset zoom` is absent while the pref is 1.
- The dialog component stays mounted, and the rail section is `useState`. A later open shows the last rail, not Appearance.
- Import / Export and the collection sidebar's import both open native dialogs. WebDriver does not see those windows. `drive-transfer.py` stubs only `plugin:dialog`.
- The dialog content uses `showCloseButton={false}`. There is no X inside the dialog; Escape or a click outside dismisses it.
- Section buttons are plain `<button>` text, not aria-labels. `About` is unique. `Network` is unique in this dialog.
