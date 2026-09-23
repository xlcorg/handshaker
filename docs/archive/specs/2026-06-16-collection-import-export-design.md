# Collection import / export — design

**Date:** 2026-06-16
**Status:** 🎉 DONE 2026-06-17 — implemented, rebased onto `main` + ff-merged; archived. Plan: [../../plans/archive/2026-06-16-collection-import-export.md](../../plans/archive/2026-06-16-collection-import-export.md).
**Branch:** `claude/inspiring-gates-48a9bf` (merged)

## Problem

Handshaker has no way to move collections or environments between machines. Each
collection already persists as `<data-dir>/collections/<uuid>.json` (an
`Envelope<Collection>`) and the whole environment set as a single
`environments.json` (`Envelope<Vec<Environment>>`), but there is no user-facing
way to write those out to a chosen location or read them back in. The user wants
to back up and transfer their work between their own machines.

This is **import / export**, not a backup/restore subsystem: import must be
**non-destructive** — it merges into the current data and never deletes anything
that isn't in the imported file.

## Decisions (settled during brainstorming)

| Question | Decision |
|---|---|
| Purpose | Back up & transfer between the user's own machines. |
| File format | Native Handshaker JSON, lossless (reuse the on-disk serde shapes). |
| Secrets | Exported **as-is** (lossless) — `client_secret` and variable values included in plaintext. Conscious choice for personal transfer; see *Secrets* below. |
| Scope | Hybrid: **per-collection** export (from a collection's row menu) **and** **export everything** (all collections + all environments) from the panel menu / Settings. |
| Import behavior | **Non-destructive merge.** Collections keyed by `id`, environments by `name`. On match → update; otherwise → add. Nothing is ever deleted. |
| Transport | A file, via native save/open dialogs (`tauri-plugin-dialog`); file I/O done in Rust. |

## Best-practice basis (sources)

- **Import is additive/non-destructive across mature clients, not wipe-and-restore.**
  Bruno regenerates UUIDs on import to avoid collisions and adds alongside existing
  data; Insomnia replaces real UUIDs with placeholders (`__WORKSPACE_ID__`, …)
  resolved on import. Neither deletes existing data.
  ([Bruno import/export](https://deepwiki.com/usebruno/bruno/5.4-import-and-export-system),
  [Insomnia import/export](https://developer.konghq.com/insomnia/import-export/))
- **Secrets in exports are a known footgun.** Postman writes "secret" variables to
  the exported file in plaintext (the secret flag only masks them in the UI); Bruno
  actively sanitizes secrets on export (`deleteSecretsInEnvs`).
  ([Postman community](https://community.postman.com/t/disable-postman-secret-variables-from-being-exported/52455),
  [Bruno](https://deepwiki.com/usebruno/bruno/5.4-import-and-export-system))
- **Export scope levels.** Insomnia offers Document / Project (= one collection) /
  All data; Bruno exports per collection with environments as separate objects.
  Per-collection export is the norm; "everything at once" is a separate explicit
  action. ([Insomnia](https://developer.konghq.com/insomnia/import-export/))
- **Format carries a type/version discriminator** (`_type` in Insomnia, version
  markers in Bruno for format detection) — validates our `kind` + `schema_version`
  envelope.
- **"Replace everything" is reserved for explicit backup/restore flows** with a
  confirmation and schema-version check — not for ordinary import/export.
  ([open-webui backup discussion](https://github.com/open-webui/open-webui/discussions/16676),
  [TechTarget](https://www.techtarget.com/searchdatabackup/answer/What-are-some-server-and-data-migration-best-practices-for-backup))

## File format

One file shape serves both export scopes; import discriminates on what's inside.
Reuses the existing `persist::Envelope` wrapper (atomic write + schema-version
gate come for free):

```json
{
  "schema_version": 1,
  "data": {
    "kind": "handshaker-export",
    "collections": [ /* core Collection, identical to the on-disk per-collection shape */ ],
    "environments": [ { "name": "prod", "variables": { "...": "..." }, "color": null } ]
  }
}
```

- **Per-collection export:** `collections: [that one]`, `environments: []`.
- **Export everything:** `collections: [all]`, `environments: [all]`.
- **Active environment is NOT stored** — import never changes the active-env
  selection (a UI preference, not data to merge).
- `kind` guards against importing an unrelated JSON (a single-collection on-disk
  file, random JSON); `read_bundle` rejects anything whose `kind` ≠ `handshaker-export`.
- The bundle uses **core types** (`Collection`, `Environment`), so the file's serde
  shape matches the existing on-disk files and import goes straight into the stores
  with no IPC-DTO round-trip. The frontend never parses the file — Rust does.

## Merge semantics (import)

Non-destructive. Nothing is ever deleted. For each item in the file:

- **Collections (key = `id`):** if a collection with that `id` exists → update it in
  place (`collection_store.upsert`); else → add. Collections on the machine that are
  not in the file are untouched. Re-importing the same file is idempotent.
- **Environments (key = `name`):** if an environment with that `name` exists → **merge
  variables** (existing variables kept; imported keys overwrite shared keys and add
  new ones); else → add the environment. `color`: take the imported value if the
  imported env sets one, else keep the existing color. Environments not in the file
  are untouched.
- **Active environment:** untouched.

Cross-machine import is therefore almost always purely additive (collection ids
differ between machines); same-machine re-import updates in place.

## Import flow (no destructive confirm)

Because import is non-destructive, there is **no "Replace everything" alert**.
Instead a light, transparent summary:

1. Native `open` dialog → file path (cancel → no-op).
2. `bundle_import_inspect(path)` — reads + validates the file, diffs against current
   stores, returns counts (no mutation). A corrupt/foreign file fails here, before
   anything changes.
3. A summary dialog renders the impact:
   *"Import N collections and M environments? K already exist and will be updated.
   Nothing is deleted."* → `Cancel` / `Import` (Import is a normal/primary button,
   not destructive-styled).
4. On confirm → `bundle_import_apply(path)` — re-reads + merges → returns a result
   summary (added/updated counts) for the toast.
5. Refresh: `catalog.reload()` for collections + an environment-list refresh signal
   (see *Frontend* — env refresh). **No full page reload** (merge is light; a reload
   would discard in-memory draft/view state).

## Backend

### Core — `crates/handshaker-core/src/bundle.rs` (new, no Tauri dep)

- `pub const BUNDLE_KIND: &str = "handshaker-export";`
- `pub struct Bundle { pub kind: String, pub collections: Vec<Collection>, pub environments: Vec<Environment> }`
  (serde + deny-unknown not required; `kind` validated explicitly).
- `pub fn write_bundle(path: &Path, bundle: Bundle) -> Result<(), CoreError>` —
  `atomic_write_json(path, &Envelope::new(bundle))`. Writes pretty JSON, temp+rename,
  creates parent dirs (existing primitive). The user-chosen path is on the user's
  filesystem; `<path>.tmp` lands beside it (same dir) — fine.
- `pub fn read_bundle(path: &Path) -> Result<Bundle, CoreError>` —
  `read_json::<Bundle>(path)` (envelope parse + future-version gate), then check
  `bundle.kind == BUNDLE_KIND` → else `CoreError::InvalidTarget("not a Handshaker export file")`.

Unit-tested on a `tempfile::TempDir`.

### Orchestration — `src-tauri` `impl AppState`

Operates directly on `collection_store` / `env_store` (store-level methods bypass
the command-layer active-env delete guard, which is irrelevant here since we never
delete).

- `bundle_export_impl(&self, path, collection_id: Option<String>) -> Result<(), CoreError>`
  - `None` → `Bundle { collections: collection_store.list(), environments: env_store.list() }`.
  - `Some(id)` → `Bundle { collections: vec![require_collection(id)?], environments: vec![] }`.
  - `bundle::write_bundle(path, bundle)`.
- `bundle_import_inspect_impl(&self, path) -> Result<ImportSummary, CoreError>`
  - `bundle::read_bundle(path)?`; diff against current stores → counts:
    `{ collections_total, collections_existing, environments_total, environments_existing }`.
  - No mutation.
- `bundle_import_apply_impl(&self, path) -> Result<ImportResult, CoreError>`
  - `bundle::read_bundle(path)?` (validate again — fail before mutating).
  - For each collection: `collection_store.upsert(c)` (id-keyed upsert = add-or-update).
  - For each environment: read current by name; if present, merge variables (existing
    ⊕ imported, imported wins on shared keys) + color rule, `env_store.upsert(merged)`;
    else `env_store.upsert(imported)`.
  - Returns `{ collections_added, collections_updated, environments_added, environments_updated }`.

*Accepted risk:* the apply loop is not transactional across stores (mirrors the
existing `collection_move_item_across` note). Validation happens fully up front, so
a corrupt/foreign file changes nothing; a mid-apply local-disk I/O failure is
extremely unlikely and, being additive, would at worst leave a partial import
(never data loss). Documented, not guarded, for v1.

### IPC — `src-tauri/src/ipc/bundle.rs` + `src-tauri/src/commands/bundle.rs`

DTOs: `ImportSummaryIpc { collections_total: u32, collections_existing: u32, environments_total: u32, environments_existing: u32 }`,
`ImportResultIpc { collections_added: u32, collections_updated: u32, environments_added: u32, environments_updated: u32 }`.

Commands (registered in `lib.rs` `collect_commands!`):
- `bundle_export(path: String, collection_id: Option<String>) -> Result<(), IpcError>`
- `bundle_import_inspect(path: String) -> Result<ImportSummaryIpc, IpcError>`
- `bundle_import_apply(path: String) -> Result<ImportResultIpc, IpcError>`

Regenerate `src/ipc/bindings.ts` (git-tracked) with the IPC change, and add thin
`bundleExport` / `bundleImportInspect` / `bundleImportApply` wrappers to
`src/ipc/client.ts` (unwrapping `Result<T, IpcError>`, same pattern as the other
`collection*` wrappers) on the exported `ipc` object.

### Plugin & permissions

- `tauri-plugin-dialog`: add to workspace `Cargo.toml` + `src-tauri/Cargo.toml`,
  register `.plugin(tauri_plugin_dialog::init())` in `lib.rs`.
- `@tauri-apps/plugin-dialog` in `package.json`.
- `src-tauri/capabilities/default.json`: add `"dialog:allow-open"`, `"dialog:allow-save"`.

## Frontend

### Orchestration — `src/features/catalog/transfer.ts` (new)

Thin module driving the dialog + IPC + refresh + toast. Uses the IPC client and
`@tauri-apps/plugin-dialog`'s `save` / `open`.

- `exportCollection(collectionId, suggestedName)` — `save({ defaultPath: "<name>.json", filters:[{name:"Handshaker export", extensions:["json"]}] })` → `ipc.bundleExport(path, collectionId)` → toast.
- `exportAll()` — same `save` with `defaultPath: "handshaker-export.json"` → `ipc.bundleExport(path, null)` → toast.
- `inspectImport()` — `open({ multiple:false, filters:[…] })` → `ipc.bundleImportInspect(path)`; returns `{ path, summary }` (or null on cancel).
- `applyImport(path)` — `ipc.bundleImportApply(path)` → returns result counts.

The summary dialog and refresh are wired where the menu lives (see below).

### UI entry points (hybrid — three surfaces, one module)

1. **Collection row menu** — `CollectionNode.tsx` `RowMenu` items: add **Export** (icon
   `Download`) between *Rename* and *Delete* → `exportCollection(col.id, col.name)`.
2. **Collections panel menu** — `SidebarShell.tsx` header "Collections" row: a new ⋯
   button (`MoreHorizontal`) next to `SortControl`, opening a `DropdownMenu` with
   **Export** (all → `exportAll()`) and **Import** (→ import flow). *Note:* "all" is
   omitted from the label by request; the panel context conveys scope. The per-row
   "Export" (one collection) vs panel "Export" (everything) are disambiguated by
   location.
3. **Settings → Import / Export** — new pane in `SettingsDialog.tsx`
   (`["import-export", "Import / Export"]`), `ImportExportPane.tsx` with **Export**
   and **Import** buttons + the muted note *"Import merges into your current data —
   nothing is deleted."*

### Import confirmation dialog

A neutral summary `AlertDialog` (not destructive), reused by the panel menu and the
Settings pane: title *"Import collections?"*, body built from `ImportSummaryIpc`
counts, actions `Cancel` / `Import`. Follows the existing confirm-dialog pattern
(`ConfirmDeleteDialog` / `ConfirmDeleteEnvDialog`, shadcn `AlertDialog`).

### Refresh after import

- Collections: `useCatalogTree().reload()` (already exists; re-fetches all collections).
- Environments: the env list is currently fetched per-component (`WorkflowEnvControl`,
  `EnvSwitcherMenu`, `SavedAuthEditor`) with no shared reload signal. Add a small
  **env-list refresh signal** (extend `envRevision.ts` — `bumpEnvRevision()` plus a
  hook the env-list consumers re-fetch on), so an import refreshes the switcher
  without a page reload. (Plan task: thread the refetch into the existing consumers.)

## Secrets

The user chose lossless export — `client_secret` (OAuth2) and environment/collection
variable values are written to the file in plaintext. This is a conscious choice for
personal machine-to-machine transfer; the file is the user's responsibility. Best
practice (Bruno sanitizes; Postman's plaintext export is a documented footgun)
suggests a future **"exclude secrets"** toggle on export — explicitly out of scope
for v1, noted as a clean extension point (sanitize on the `Bundle` before
`write_bundle`).

## Out of scope (YAGNI)

- Foreign formats (Postman / Insomnia / OpenAPI / HAR / cURL).
- Backup/restore "replace everything" semantics.
- Encryption of the export file; "exclude secrets" toggle.
- Per-conflict prompts (Update / Keep both / Skip) — policy is fixed to
  update-on-match.
- Importing the active-env selection or app settings / ui-state / contract cache.
- Importing from clipboard or URL.

## Testing

- **core (`bundle.rs`):** round-trip `Bundle` through `write_bundle`/`read_bundle` on a
  tempdir; `kind` validation rejects a foreign file; future `schema_version` rejected
  (inherited from `Envelope` gate); variable order/contents preserved.
- **src-tauri (`AppState` impls):** export-all gathers all collections + envs;
  export-one writes a single-collection bundle; import-apply **adds** new, **updates**
  matching (collection by id, env variables by name), and **does not delete**
  non-referenced collections/envs/variables; `inspect` returns correct add/update
  counts without mutating; a corrupt/foreign file → error and stores untouched;
  active env unchanged by import.
- **frontend:** `transfer.ts` with mocked `ipc` + mocked `@tauri-apps/plugin-dialog`
  (`save`/`open`); cancel paths no-op; render tests for the new row-menu item, panel
  ⋯ menu, `ImportExportPane`, and the import summary dialog.
- **gate:** `cargo test --workspace`, `vitest`, `tsc`, `vite build`, bindings no-drift.

## Open questions

None blocking. Live WebView2 pass (native dialogs on Windows; round-trip across two
data dirs) is the post-merge follow-up.
