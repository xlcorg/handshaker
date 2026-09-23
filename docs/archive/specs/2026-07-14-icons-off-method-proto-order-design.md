# Icons off by default · methods in `.proto` order — design

Status: **🎉 DONE — shipped to `main`** · 2026-07-14

Two small, independent behavior changes:

1. **gRPC icon off by default** — new installs show no gRPC glyph next to saved
   requests in the sidebar tree.
2. **Methods in definition order** — the method list (MethodPicker and every other
   catalog surface) shows methods in `.proto` definition order instead of alphabetical.
   Services stay alphabetically sorted.

## Motivation

- The gRPC glyph in the request list is visual noise for most users; opt-in is the
  better default. It remains fully configurable in Settings → Appearance.
- Alphabetical method sorting discards the author's intended grouping. Proto files list
  methods in a meaningful order (e.g. lifecycle: `Create`, `Get`, `Update`, `Delete`);
  alphabetizing scatters that. Definition order is what the API author chose.

## Change 1 — gRPC icon off by default

### Behavior

- `PREFS_DEFAULTS.grpcIcon` flips from `"solid"` to `"off"`.
- `RequestRow` already gates the glyph behind `grpcIcon !== "off"`
  (`src/features/catalog/RequestRow.tsx`), so no component change is needed — the row
  renders the label only, and the label already claims the freed space.
- **Existing users keep what they have:** prefs are read via
  `{ ...PREFS_DEFAULTS, ...parsed }` from `localStorage` (`handshaker.prefs.v1`).
  `setPref` persists the *entire* prefs object the first time any setting is changed, so
  anyone who has ever touched a setting has `grpcIcon` already persisted (at its
  then-current value) and keeps it. Only a profile with no persisted prefs at all — a
  fresh install — picks up the new `"off"` default. This is standard default-change
  semantics: we change the default, we do not migrate/override existing choices.
- Re-enabling is unchanged: Settings → Appearance → "gRPC icon" ToggleGroup already
  offers `off / solid / letter / outline / circle` (`AppearancePane.tsx`).

### Files

- `src/lib/use-prefs.ts` — `PREFS_DEFAULTS.grpcIcon: "solid"` → `"off"` (one line).

### Tests

- `src/lib/use-prefs.test.ts` — the `defaults grpcIcon to 'solid'` assertion becomes
  `'off'`. The existing `merges a persisted grpcIcon:'off'` test stays.
- `src/features/catalog/RequestRow.test.tsx` — the first test,
  `renders the gRPC icon (default solid)`, currently relies on the default producing a
  glyph. Rewrite to reflect the new default:
  - Default now renders **no** glyph → assert `screen.queryByLabelText("grpc")` is
    `null` (and the label text still renders).
  - Add one positive test: set the pref to a style (`setPref("grpcIcon", "solid")`),
    render, assert the glyph appears with `data-variant="solid"`; reset the pref
    afterward (module-level singleton leaks within a test file) via
    `afterEach`/`setPref("grpcIcon", "off")`.
- `src/features/settings/AppearancePane.test.tsx` — **no change required.** Its
  `resetPrefs()` helper explicitly clicks `"solid"` in `beforeEach`, so every test starts
  with `grpcIcon === "solid"` regardless of the default. The two inline comments that say
  "default solid" are now slightly inaccurate (the value comes from the reset click, not
  the default); optionally reword them, but the assertions pass as-is.

## Change 2 — methods in `.proto` definition order

### Where the sort lives

The catalog is projected once in the Rust core, in
`crates/handshaker-core/src/grpc/catalog/build.rs`:

```rust
methods.sort_by(|a, b| a.name.cmp(&b.name));      // line 23 — REMOVE
...
services.sort_by(|a, b| a.full_name.cmp(&b.full_name));  // line 30 — KEEP
```

`prost_reflect` yields methods in descriptor (definition) order; the `sort_by` on
line 23 overwrites that. Removing it lets definition order flow through. **Services keep
their alphabetical sort** (line 30) — a stable, predictable service list is worth more
than reflection's unspecified service ordering.

Because the sort is in the core and the ordered `ServiceCatalog` is the single source
consumed by the whole frontend, definition order applies everywhere the catalog renders
(MethodPicker, Contract view, command-palette method search) — not just the picker.
This is the intended outcome; there is no per-surface override, and none is wanted.

### Files

- `crates/handshaker-core/src/grpc/catalog/build.rs`
  - Remove the `methods.sort_by(...)` line.
  - Update the doc comment (`//! Project ...` / the `build_catalog` doc) to state:
    services sorted by `full_name`; methods preserved in definition order.

### Tests

- `crates/handshaker-core/src/grpc/catalog/build.rs` unit test
  `catalog_is_sorted_and_method_paths_correct`:
  - The fixture defines `Alpha`'s methods as `Bar, Foo` — coincidentally already
    alphabetical, so it would pass either way and prove nothing. **Reorder the fixture**
    to define them non-alphabetically (`Foo` then `Bar`) and assert the catalog preserves
    that order: `methods[0].name == "Foo"`, `methods[1].name == "Bar"`. Move the
    `client_streaming`/`server_streaming` assertions onto `Bar` at its new index (1).
  - Keep the service-order assertions (`services[0] == "test.Alpha"`,
    `services[1] == "test.Beta"`) — services stay sorted.
  - Rename the test to reflect intent, e.g.
    `services_sorted_methods_in_definition_order`.

## Boundaries / non-goals

- **No IPC/DTO shape change.** `ServiceCatalog` / `ServiceEntry` / `MethodEntry` are
  untouched; only element order changes. `src/ipc/bindings.ts` is not regenerated.
- No new preference, toggle, or UI for method ordering — definition order is simply the
  behavior.
- No change to collection sorting (`src/features/catalog/sort.ts`), env ordering, or any
  other list.

## Verification gate

`pnpm lint` + `pnpm test` + `cargo test --workspace` all green before the fast-forward
merge. The IPC surface is unchanged, but the full frontend suite still runs per the
project gate.
