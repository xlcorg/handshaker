# Collections

Creating a collection from the sidebar persists it. The end state that proves
this works: `[aria-label="rename-input"]` has value `New collection`, and
`$XDG_DATA_HOME/dev.handshaker.app/collections/<data-node-id>.json` is a new
envelope whose `data.name` is `New collection`. The row also expands, so the
placeholder `Empty collection` is visible under the field.

## Sub-features

- Filter the tree (`aria-label="collection-filter"`, placeholder `Filter collections…`).
- New collection and new request from the `+` menu (`aria-label="new-item"`, then `new-collection` or `new-request`).
- Open a collection overview (`aria-label="open-collection"`) with tabs Overview, Authorization, Variables, and `aria-label="close-overview"`.
- Collapse / expand all, sort (`aria-label="sort-collections"`), pin (`aria-label="pin-collection"`).
- Export / import from `aria-label="collection actions"`.

## How to get to it (user POV)

The sidebar is the left column under the titlebar, headed `COLLECTIONS`. On a
fresh profile the only row is `My Collection` and the main pane says there is
no active request. The `+` button at the top of the sidebar opens `New request`
and `New collection`. Choosing `New collection` inserts a row already in
rename, named `New collection`.

## Driving it with Tauri WebDriver

```sh
.cursor/skills/verify-handshaker/scripts/drive-collections.sh
```

The same steps by hand, against the session `launch.sh` started:

```sh
.cursor/skills/verify-handshaker/scripts/hsdrv.py screenshot collections-before
.cursor/skills/verify-handshaker/scripts/hsdrv.py click "[aria-label='new-item']"
.cursor/skills/verify-handshaker/scripts/hsdrv.py click "[aria-label='new-collection']"
.cursor/skills/verify-handshaker/scripts/hsdrv.py screenshot collections-renaming
.cursor/skills/verify-handshaker/scripts/hsdrv.py eval 'const i=document.querySelector("[aria-label=rename-input]"); return i?i.value:""'
```

`collections-before.png` is the idle sidebar. `collections-renaming.png` is the new row in the rename field.

`drive-collections.sh` then reads `data-node-id` on the rename row and opens
`collections/<id>.json` under the run's data dir.

A new request draft, instead of a collection:

```sh
.cursor/skills/verify-handshaker/scripts/hsdrv.py click "[aria-label='new-item']"
.cursor/skills/verify-handshaker/scripts/hsdrv.py click "[aria-label='new-request']"
.cursor/skills/verify-handshaker/scripts/hsdrv.py screenshot collections-new-request
```

The main pane then shows `[aria-label="draft-address"]` (placeholder
`host:port`) and a `Save` button (`aria-label="Save"`). The address bar Send
button reads `▶ Send` and stays disabled until a method is chosen.

## Gotchas

- The first launch of an empty data dir writes `My Collection` by itself. A
  successful create is a second file, not the first.
- The new row is focused in `[aria-label="rename-input"]`. Blur with the same
  text cancels edit mode and keeps the name. Blur with different text renames
  it. Read the input before clicking anywhere else.
- While that input is up, the row has no `open-collection` button. The
  persisted `expanded` flag is still false; the tree opens the row only
  because it is being edited, which is why `Empty collection` shows.
- Import and export call the native file dialog (`@tauri-apps/plugin-dialog`).
  That dialog is outside the web view, so WebDriver does not see it. Drive
  create / rename / filter, which stay in the page.
- Collection JSON is one file per id under `collections/`. Sort order and the
  active request live in `ui-state.json` next to that directory, not in the
  collection file.
