# Settings

Opening Settings shows the local preferences dialog. The end state that
proves this works: the dialog heading is `Settings`, the subtitle is
`Preferences persist locally. Restart not required.`, and the default
Appearance section shows the row `gRPC icon`. The About section's version
line equals `package.json` / the Cargo package version (`0.2.35` when this
map was written).

## Sub-features

- Appearance — gRPC icon, zoom (`aria-label="Zoom in"`, `Zoom out`, `Reset zoom`), sidebar, split direction, word wrap, method-picker group style (`aria-label="method-list-style"`), variable highlight (`aria-label="var-highlight-scheme"`).
- Network — request deadline and max message size.
- Keyboard — shortcut list.
- Import / Export — bundle transfer. The file picker is a native dialog.
- About — version, runtime `tauri 2 · react 18`, and Check for updates.

## How to get to it (user POV)

The gear button is at the right of the titlebar, before the window buttons.
Its tooltip and accessible name are `Settings`. The dialog opens on
Appearance. The left rail is Appearance, Network, Keyboard, Import / Export,
About. Close it with Escape. The window-chrome buttons on Linux are
`aria-label="Minimize window"`, `Maximize window`, and `Close window`.
Minimize and close are real window operations; do not click Close during a
drive unless you mean to end the session.

## Driving it with Tauri WebDriver

```sh
.cursor/skills/control-app/scripts/hsdrv.py screenshot settings-before
.cursor/skills/control-app/scripts/hsdrv.py click "[aria-label='Settings']"
.cursor/skills/control-app/scripts/hsdrv.py screenshot settings-appearance
.cursor/skills/control-app/scripts/hsdrv.py eval 'return document.body.innerText.includes("Preferences persist locally") && document.body.innerText.includes("gRPC icon")'
.cursor/skills/control-app/scripts/hsdrv.py click "xpath=//button[normalize-space()=\"About\"]"
.cursor/skills/control-app/scripts/hsdrv.py screenshot settings-about
.cursor/skills/control-app/scripts/hsdrv.py eval 'return document.body.innerText.includes("version") && document.body.innerText.includes("tauri 2")'
```

The first `eval` is the Appearance proof. About is the version proof. Escape
closes the dialog:

```sh
.cursor/skills/control-app/scripts/hsdrv.py eval 'document.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true})); return document.body.innerText.includes("Preferences persist locally")'
.cursor/skills/control-app/scripts/hsdrv.py screenshot settings-closed
```

After a real close that expression is false. Appearance edits persist in
`localStorage` key `handshaker.prefs.v1` inside the web view profile (under
the run's data dir, `localstorage/tauri_localhost_0.localstorage`), not in
`ui-state.json`. `ui-state.json` holds the collection sort key and the active
request.

## Gotchas

- Check for updates hits the GitHub latest-release endpoint configured in
  `src-tauri/tauri.conf.json`. A drive of About should read the version text
  and not click `Check for updates` unless the network is meant to be part of
  the check. The button's accessible name on the titlebar is `Check for updates`.
- Zoom buttons call `webview.setZoom`. The percentage label moves immediately; the web view scale follows.
- Import / Export and the collection sidebar's import both open native dialogs. WebDriver does not see those windows.
- The dialog content uses `showCloseButton={false}`. There is no X inside the dialog; Escape or a click outside dismisses it.
- Section buttons are plain `<button>` text, not aria-labels. `About` is unique. `Network` is unique in this dialog.
