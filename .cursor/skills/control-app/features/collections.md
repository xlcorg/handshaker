# Collections

Creating a collection from the sidebar persists it. The end state that proves
this works: `[aria-label="rename-input"]` has value `New collection`, and
`$XDG_DATA_HOME/dev.handshaker.app/collections/<data-node-id>.json` is a new
envelope whose `data.name` is `New collection`. The row also expands, so the
placeholder `Empty collection` is visible under the field.

## Sub-features

- Filter the tree (`aria-label="collection-filter"`, placeholder `Filter collections…`).
- New collection, new gRPC request, and new HTTP request from the `+` menu (`aria-label="new-item"`, then `new-collection`, `new-request`, or `new-http-request`).
- Open a collection overview (`aria-label="open-collection"`) with tabs Overview, Authorization, Variables, and `aria-label="close-overview"`.
- Collapse / expand all, sort (`aria-label="sort-collections"`), pin. The pin button is `aria-label="pin-collection"` while unpinned and `aria-label="unpin-collection"` while pinned.
- Export and import of one JSON format, `handshaker-export`. Sidebar `aria-label="collection actions"`, the collection row menu, and Settings → Import / Export. `scripts/drive-transfer.py` drives all of those paths.

## How to get to it (user POV)

The sidebar is the left column under the titlebar, headed `COLLECTIONS`. On a
fresh profile the only row is `My Collection` and the main pane says there is
no active request. The `+` button at the top of the sidebar opens `New request`,
`New HTTP request`, and `New collection`. Choosing `New collection` inserts a
row already in rename, named `New collection`.

## Driving it with Tauri WebDriver

```sh
.cursor/skills/control-app/scripts/drive-collections.sh
```

The same steps by hand, against the session `launch.sh` started:

```sh
.cursor/skills/control-app/scripts/hsdrv.py screenshot collections-before
.cursor/skills/control-app/scripts/hsdrv.py click "[aria-label='new-item']"
.cursor/skills/control-app/scripts/hsdrv.py click "[aria-label='new-collection']"
.cursor/skills/control-app/scripts/hsdrv.py screenshot collections-renaming
.cursor/skills/control-app/scripts/hsdrv.py eval 'const i=document.querySelector("[aria-label=rename-input]"); return i?i.value:""'
```

`collections-before.png` is the idle sidebar. `collections-renaming.png` is the new row in the rename field.

`drive-collections.sh` then reads `data-node-id` on the rename row and opens
`collections/<id>.json` under the run's data dir.

A new request draft, instead of a collection:

```sh
.cursor/skills/control-app/scripts/hsdrv.py click "[aria-label='new-item']"
.cursor/skills/control-app/scripts/hsdrv.py click "[aria-label='new-request']"
.cursor/skills/control-app/scripts/hsdrv.py screenshot collections-new-request
```

The main pane then shows `[aria-label="draft-address"]` (placeholder
`host:port`) and a `Save` button (`aria-label="Save"`). The address bar Send
button reads `▶ Send` and stays disabled until a method is chosen.

Export and import:

```sh
python3 .cursor/skills/control-app/scripts/drive-transfer.py
```

`drive-transfer.py` starts and stops `scripts/http-echo.py`. It does not start the gRPC echo server.

The only format is an envelope written by `persist`. `schema_version` is 1.
`data.kind` is `handshaker-export`. `data.collections` and `data.environments`
follow. Postman, Insomnia, OpenAPI, HAR, and cURL are not import paths.

| Entry | What the file contains |
| --- | --- |
| Sidebar `aria-label="collection actions"`, then `aria-label="export"` | Every collection and every environment. Default name `handshaker-export.json`. |
| Collection row `aria-label="More options"`, then menuitem `Export` | That collection. `environments` is `[]`. Default name is the collection name plus `.json`. The More options button is `opacity-0` until hover. WebDriver can still click it. The collection row's button is the following sibling of `div[data-node-id="<id>"]`. |
| Settings rail button `Import / Export`, then `Export` | Same bytes as the sidebar all-export. |
| Sidebar `aria-label="import"` | Opens the file, then `Import collections?`. |
| Settings `Import` | Same confirm dialog. |

The native save and open dialogs are GTK windows. WebDriver does not see them.
`drive-transfer.py` proves `app_version` travels as `ipc://localhost/app_version`,
then wraps `window.fetch` so only `plugin:dialog` save and open return a path.
`bundle_export`, `bundle_import_inspect`, and `bundle_import_apply` stay real.
The confirm dialog, the toasts, and the catalog reload stay real.

Confirm title is `Import collections?`. Buttons are `Cancel` and `Import`.
The body is `N collections and M environments will be imported.` When ids or
environment names already exist it adds `K already exist and will be updated.`
It always ends with `Nothing is deleted.` Export toast is `Exported`. Import
toast is `Imported — A added, U updated`. The toaster duration is 1500ms.
Mark existing `[data-sonner-toast]` nodes before the click, or the next wait
sees a toast that already expired.

A clean load with no collection files seeds `My Collection` before the import
appears, so the sidebar shows that row plus the imported names. Display sort
defaults to alpha. Item order inside a collection is the array order in the file.

Corrupt JSON toasts `parse <path>: ...` and does not write. Kind `other`
toasts `not a Handshaker export file (kind \`other\`)`. `schema_version` 2
toasts `unsupported schema v2 in <path> (this build supports up to v1)`.

Same collection name with a new id is kept as a second row. Same collection
id merges. Collection settings (name, auth, variables, TLS, links) come from
the file. Items merge by id. A matching request or folder takes the file's
fields and stays where it already sits. A request or folder that exists only
locally stays in that slot. A new id from the file is appended under the
parent it has in the file. Environments merge by name. Imported keys replace
local keys. A color on the import replaces the local color. An import with
no color leaves the local color. New environments are appended. The active
environment is unchanged. Nothing outside the file is removed, and nothing
that exists only locally is removed either.

The dialog says matching items are updated, items only on this machine are
kept, and nothing is deleted. `scripts/drive-reimport-merge.py` exports a
collection, adds a request in the window, edits one request in the file, and
re-imports. The local request, the edited request, and the new file request
are all present afterward.

## Gotchas

- Any load whose collection list is empty writes `My Collection`
  (`useCatalogTree` reload). A successful create on that profile is a second
  file. A seeded non-empty profile does not get another `My Collection`.
- The new row is focused in `[aria-label="rename-input"]`. Blur with the same
  text cancels edit mode and keeps the name. Blur with different text renames
  it. Read the input before clicking anywhere else.
- While that input is up, the row has no `open-collection` button. The
  persisted `expanded` flag is still false; the tree opens the row only
  because it is being edited, which is why `Empty collection` shows.
- Import and export call the native file dialog (`@tauri-apps/plugin-dialog`).
  Drive them with `drive-transfer.py`, which stubs only that dialog. Create,
  rename, and filter stay in the page and do not need the stub.
- Collection JSON is one file per id under `collections/`. Sort order and the
  active request live in `ui-state.json` next to that directory, not in the
  collection file.
