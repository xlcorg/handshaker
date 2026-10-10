# Environments

Creating an environment stores it and selects it. The end state that proves
this works: the titlebar pill reads the new name (not `No environment`), and
`$XDG_DATA_HOME/dev.handshaker.app/environments.json` contains that name.

## Sub-features

- The titlebar pill. With nothing active its text is `No environment`.
- Menu header `Environments`, row `No environment`, and `aria-label="New environment"`.
- Editor dialog. Create title `New environment`, name field `aria-label="Name"` (placeholder `e.g. prod`), variables table, buttons `Create` and `Cancel`.
- Per-row edit (`aria-label="Edit <name>"`). Delete is a button in the editor, then a confirm dialog, not a control on the menu row.
- Drag reorder inside the menu. Order is the backend list order.

## How to get to it (user POV)

The pill sits in the titlebar, to the right of the workflow name `workflow-1`.
Click it. The menu lists `No environment` and a `+` button. The `+` opens
`New environment`. Type a name, press `Create`. The dialog closes and the
pill shows the name. Ctrl+E cycles real environments and skips
`No environment`. Ctrl+Shift+E opens the editor for the active one (or create
mode when none is active).

## Driving it with Tauri WebDriver

The pill has no aria-label. Its visible text is the selector. With a fresh
profile that text is `No environment`, and the menu is unmounted until the
pill is clicked, so this xpath matches only the pill:

```sh
.cursor/skills/control-app/scripts/hsdrv.py screenshot env-before
.cursor/skills/control-app/scripts/hsdrv.py click "xpath=//button[contains(.,\"No environment\")]"
.cursor/skills/control-app/scripts/hsdrv.py screenshot env-during-menu
.cursor/skills/control-app/scripts/hsdrv.py click "[aria-label='New environment']"
.cursor/skills/control-app/scripts/hsdrv.py screenshot env-during-dialog
.cursor/skills/control-app/scripts/hsdrv.py click "[aria-label='Name']"
.cursor/skills/control-app/scripts/hsdrv.py eval 'const el=document.querySelector("[aria-label=Name]"); const set=Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el),"value").set; set.call(el,"staging"); el.dispatchEvent(new Event("input",{bubbles:true})); return el.value'
.cursor/skills/control-app/scripts/hsdrv.py screenshot env-during-named
.cursor/skills/control-app/scripts/hsdrv.py click "xpath=//button[normalize-space()=\"Create\"]"
.cursor/skills/control-app/scripts/hsdrv.py screenshot env-after
```

`env-before.png` shows the pill reading `No environment`. `env-during-menu.png` shows the open menu. `env-during-dialog.png` shows the empty editor. `env-during-named.png` shows `staging` in the name field. `env-after.png` shows the pill reading `staging`. All five files are in the run's `evidence/` directory.

Then confirm both surfaces:

```sh
.cursor/skills/control-app/scripts/hsdrv.py eval 'return document.body.innerText.includes("staging")'
```

and read `environments.json` under the run's `dataDir` from `session.json`.
The envelope's environment list includes `staging`. That file is the proof,
together with the pill text.

## Gotchas

- `No environment` is a menu row and the pill label. After the menu opens, an
  xpath of `contains(., "No environment")` matches both. Click the pill before
  the menu exists, then use `aria-label="New environment"` for the `+`.
- Duplicate names surface the inline error `name already exists` and do not write.
- Variables are edited in the same dialog (`aria-label` like `delete variable <key>`). An empty key is kept in the table until save.
- The active name is also written to `active_env.json` in the data dir. The pill follows the active workflow, which starts as `workflow-1`.
- Ctrl+E does nothing when the list is empty, and the key is delivered to the page. Do not send it while a Monaco editor is focused unless you want the editor to see it; the app stops the event only when it actually cycles.
