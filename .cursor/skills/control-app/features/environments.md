# Environments

Creating an environment stores it and selects it. The end state that proves
this works: the titlebar pill reads the new name (not `No environment`), and
`$XDG_DATA_HOME/dev.handshaker.app/environments.json` contains that name.

## Sub-features

- The titlebar pill. With nothing active its text is `No environment`.
- Menu header `Environments`, row `No environment`, and `aria-label="New environment"`.
- Editor dialog titled `Environments`. A left list (`nav` `aria-label="Environments"`) and a variable pane. The draft row in that list is `New environment` (`data-field="newEnv"`).
- Create. Name field `aria-label="Environment name"` (placeholder `e.g. prod`). Footer buttons `Cancel` and `Create`. `Create` stores the environment, selects it, and leaves the editor open on that environment. `Done` closes it.
- Edit. Per-row pencil `aria-label="Edit <name>"`, or the environment's button in the left list (`data-field="env:<name>"`). Changes save on their own. Footer `Delete` (`aria-label="Delete environment"`) opens `Delete "<name>"?` with `Cancel` and `Delete environment`. `Done` closes.
- Variables. The header button reads `Variable` (CSS uppercase, so `innerText` is `VARIABLE`). The value column is `Value`. Default sort trigger is `Sort: Oldest first`. The menu items are `Name A–Z`, `Name Z–A`, `Oldest first`, `Newest first`. Clicking the `VARIABLE` header from `Oldest first` or `Newest first` selects `Name A–Z`, then toggles `Name A–Z` / `Name Z–A`.
- `Add variable` (`data-field="add"`) appends a draft row and focuses `aria-label="Variable name"` (placeholder `VARIABLE_NAME`). The value cell is a `textarea` `aria-label="Value"`. The check button `aria-label="Add variable"` commits the draft. `aria-label="Cancel adding variable"` drops it.
- Search. `aria-label="Search keys"`, placeholder `Search keys…`. A query that misses shows `No matching keys`.
- The pane header shows `N variables` (or `1 variable`), then the save status to its right (`Saving…`, `Saved`, or `Not saved`). `Saved` stays briefly, then the status text clears. The status node is `role="status"`.
- Color. `aria-label="Environment color"` opens twelve swatches: `Gray`, `Coral`, `Orange`, `Yellow`, `Green`, `Teal`, `Cyan`, `Blue`, `Indigo`, `Purple`, `Pink`, `Brown`.
- Drag reorder inside the menu. Order is the backend list order.

## How to get to it (user POV)

The pill sits in the titlebar, to the right of the workflow name `workflow-1`.
Click it. The menu lists `No environment` and a `+` button. The `+` opens the
editor on a new environment. Type a name, press `Create`. The pill shows the
name and the editor stays open. Press `Done` to close it. Ctrl+E cycles real
environments and skips `No environment`. Ctrl+Shift+E opens the editor for the
active one (or create mode when none is active).

## Driving it with Tauri WebDriver

The pill has no aria-label. Its visible text is the selector. With a fresh
profile that text is `No environment`, and the menu is unmounted until the
pill is clicked, so this xpath matches only the pill:

```sh
.cursor/skills/control-app/scripts/hsdrv.py screenshot env-before
.cursor/skills/control-app/scripts/hsdrv.py click "xpath=//button[contains(.,\"No environment\")]"
.cursor/skills/control-app/scripts/hsdrv.py screenshot env-menu
.cursor/skills/control-app/scripts/hsdrv.py click "[aria-label='New environment']"
.cursor/skills/control-app/scripts/hsdrv.py screenshot env-editor-empty
.cursor/skills/control-app/scripts/hsdrv.py click "[aria-label='Environment name']"
.cursor/skills/control-app/scripts/hsdrv.py eval 'const el=document.querySelector("[aria-label=\"Environment name\"]"); const set=Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el),"value").set; set.call(el,"staging"); el.dispatchEvent(new Event("input",{bubbles:true})); return el.value'
```

Sort, the header toggle, a variable, and search, still inside that dialog:

```sh
.cursor/skills/control-app/scripts/hsdrv.py click "[aria-label='Environment color']"
.cursor/skills/control-app/scripts/hsdrv.py click "[aria-label='Blue']"
.cursor/skills/control-app/scripts/hsdrv.py click 'xpath=//button[starts-with(normalize-space(.),"Sort:")]'
.cursor/skills/control-app/scripts/hsdrv.py click 'xpath=//*[@role="menuitemradio"][normalize-space()="Oldest first"]'
.cursor/skills/control-app/scripts/hsdrv.py click 'xpath=//th//button[contains(.,"VARIABLE")]'
.cursor/skills/control-app/scripts/hsdrv.py click '[data-field="add"]'
.cursor/skills/control-app/scripts/hsdrv.py click "[aria-label='Search keys']"
.cursor/skills/control-app/scripts/hsdrv.py click "xpath=//div[@role=\"dialog\"]//button[normalize-space()=\"Create\"]"
.cursor/skills/control-app/scripts/hsdrv.py screenshot env-after-create
.cursor/skills/control-app/scripts/hsdrv.py click "xpath=//div[@role=\"dialog\"]//button[normalize-space()=\"Done\"]"
.cursor/skills/control-app/scripts/hsdrv.py screenshot env-closed
```

`env-before.png` shows the pill reading `No environment`. `env-menu.png` shows
the open menu. `env-editor-empty.png` shows the two-pane editor with
`Sort: Oldest first`. `env-after-create.png` shows the editor still open and
the pill reading `staging`. `env-closed.png` shows the pill after `Done`.
All of those files are in the run's `evidence/` directory.

Then confirm both surfaces:

```sh
.cursor/skills/control-app/scripts/hsdrv.py eval 'return document.body.innerText.includes("staging")'
```

and read `environments.json` under the run's `dataDir` from `session.json`.
The envelope's environment list includes `staging`. That file is the proof,
together with the pill text. The active name is also written to
`active_env.json`.

## Gotchas

- `No environment` is a menu row and the pill label. After the menu opens, an
  xpath of `contains(., "No environment")` matches both. Click the pill before
  the menu exists, then use `aria-label="New environment"` for the `+`.
- The menu heading is CSS `uppercase`, so `innerText` is `ENVIRONMENTS`.
  Environment rows are `//*[@data-env-row="NAME"]//*[@role="menuitem"]`.
  A row xpath that only matches `menuitem` hits the row and its edit control.
- `onSaved` is not awaited. `environments.json` and `active_env.json` can
  exist before the pill text changes. Poll the pill. `Create` leaves the
  dialog open.
- A full export includes environments. A one-collection export writes
  `environments: []`. See `collections.md`.
- Duplicate names surface the inline error `An environment with this name already exists` and do not write.
- Sort resets to `Oldest first` each time the editor opens. The `VARIABLE`
  header is a button.
- The save-status node follows the variable count in the header. `Saved`
  clears on its own, so a later read can show an empty `role="status"`.
- Closing with a save still in flight updates the list immediately. If that
  write fails, the list rolls back and a toast reads `Couldn't write the environment file`.
- The active name follows the active workflow, which starts as `workflow-1`.
- Ctrl+E does nothing when the list is empty, and the key is delivered to the page. Do not send it while a Monaco editor is focused unless you want the editor to see it; the app stops the event only when it actually cycles.
- `Cancel` and `Done` close the editor by setting `open` to false while the dialog stays mounted. After Cancel, `document.body` must not keep `pointer-events: none` or `data-scroll-locked`. `drive-http.py` raises if either is still set and does not clear them. The pill itself is the second titlebar button whose label uses `max-w-[180px]`; the first is the workflow name `workflow-1`. A `button span.truncate` selector hits the workflow name. Open the menu with a WebDriver pointer click (`hsdrv.py click`), not `element.click()`.
