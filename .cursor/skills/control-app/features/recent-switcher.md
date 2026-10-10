# Recent switcher

Hold Ctrl and press Tab to list what the main pane showed in this session. Release Ctrl to open the highlighted row. Press Escape to close the list and leave the pane as it is.

## Sub-features

- Overlay with `role="listbox"` and `aria-label="Recently opened"`. It is not a dialog. It does not take focus. It has no backdrop.
- Each row is `role="option"`. The highlighted row has `aria-selected="true"`.
- Ctrl+Tab highlights the previous row. The first Ctrl+Shift+Tab highlights the oldest row.
- Releasing Ctrl opens the highlighted row.
- Escape closes the list and leaves the pane unchanged.
- A primary-button press on a row opens that row.
- The row for the request already loaded, and the row for an open New request, show that draft again. A collection overview closes. The draft stays the same object.

## How to get to it (user POV)

Open two saved requests so the second one fills the main pane. Hold Ctrl and press Tab. A list appears near the top of the window. Its accessible name is `Recently opened`. The previous request is highlighted. Release Ctrl. That request is what the main pane shows.

Open a saved request, then open its collection overview. Hold Ctrl and press Tab until the loaded request is highlighted. Release Ctrl. The overview closes and that same request is in the main pane.

## Driving it with Tauri WebDriver

The overlay is absent until the chord is held. Dispatch the chord on `window`. Do not click a backdrop, and do not wait for focus to move.

```sh
.cursor/skills/control-app/scripts/hsdrv.py eval 'window.dispatchEvent(new KeyboardEvent("keydown",{key:"Tab",ctrlKey:true,bubbles:true,cancelable:true})); const box=document.querySelector("[role=listbox]"); return box?box.getAttribute("aria-label"):null'
```

The result is `Recently opened`. Rows are `[role="option"]`. The highlighted row has `aria-selected="true"`.

Release Ctrl to open that row. The list is gone afterward.

```sh
.cursor/skills/control-app/scripts/hsdrv.py eval 'window.dispatchEvent(new KeyboardEvent("keyup",{key:"Control",bubbles:true})); return document.querySelector("[role=listbox]")'
```

The result is `null`. The main pane shows the row that was highlighted.

Escape closes the list and does not change the pane.

```sh
.cursor/skills/control-app/scripts/hsdrv.py eval 'window.dispatchEvent(new KeyboardEvent("keydown",{key:"Tab",ctrlKey:true,bubbles:true,cancelable:true})); window.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true,cancelable:true})); return document.querySelector("[role=listbox]")'
```

The result is `null`, and the pane is the one that was showing before the chord.

## Gotchas

- Releasing Ctrl opens the highlighted row. Escape closes the list and leaves the pane unchanged.
- Focus inside `[role="dialog"]`, `[role="alertdialog"]`, or `[role="menu"]` swallows the opening Ctrl+Tab. The list stays closed. Tab still moves the highlight if the list is already open.
- The listbox never becomes `document.activeElement`.
- On macOS, Ctrl+click is a context click. The switcher swallows that context menu, including the menu event that arrives after the click has already closed the list.
- The list keeps at most ten locations from this session. After a restart, Ctrl+Tab does nothing until the pane has shown two locations.
- This note does not prove WebKitGTK delivers Ctrl+Tab to the page. If the keydown eval returns `null`, the window ate the chord before the listener ran.
