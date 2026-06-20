# Порядок переменных + хоткей открытия Edit environment — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Variable rows keep their entered order across restart/export, and `Ctrl+Shift+E` opens Edit environment for the active environment.

**Architecture:** Flip the `variables` field of core `Environment` and `Collection` from `HashMap<String,String>` to `IndexMap<String,String>` (insertion-order-preserving). The resolve engine (`VariableSet`) stays on `&HashMap` — order is irrelevant to resolution — so the two construction sites convert at the boundary. specta folds `IndexMap` into the same `DataType::Map` as `HashMap`, so `bindings.ts` does not drift and the frontend is untouched for the ordering fix. The hotkey mirrors the existing `Ctrl+E` env-cycle pattern (pure predicate + capture-phase listener).

**Tech Stack:** Rust (handshaker-core + src-tauri), `indexmap` crate, tauri-specta bindings, React 18 + TypeScript + Vitest.

**Status banner:** ✅ code-complete (гейт зелёный, spec+quality ревью на каждой половине + финальное ревью = READY TO MERGE). Остаток — live WebView2-проход + вливание ff в `main`. Ветка `claude/peaceful-gauss-f0850e`. Коммиты: `10c4aaf` (core IndexMap) · `2d7df41` (IPC) · `afac67f` (predicate) · `60b2091` (wire+hint) · `6f9d684` (Cargo.lock). Гейт: `cargo test --workspace` · `pnpm test` 1084 · `pnpm lint` · `pnpm build` · bindings no-drift (specta сворачивает `IndexMap`→тот же TS `Record`).

**Commit convention:** conventional commits; end every commit message with:
```
Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
```

**Key facts (verified):**
- `IndexMap` preserves insertion order and serde-serializes a JSON object in that order ([indexmap](https://docs.rs/indexmap/latest/indexmap/)).
- specta (rc.22) consolidates `HashMap`/`BTreeMap`/`IndexMap` into one `DataType::Map` → identical TS `Record` ([specta Type trait](https://docs.rs/specta/latest/specta/type/trait.Type.html)); enable feature `indexmap`.
- **Stores keep `HashMap` internally** (keyed by env name / collection id) — ONLY the `variables` FIELDS flip. Many files therefore keep BOTH `use std::collections::HashMap` and add `use indexmap::IndexMap`.
- The migration is a type change: the crate won't compile half-done. After making the enumerated edits, **let `cargo` flag any missed `variables:` site** — fix it the same way (`HashMap::new()` → `IndexMap::new()`).

---

## File Structure

**Task 1 — core `variables` → IndexMap (gate: `cargo test -p handshaker-core`)**
- Modify: `Cargo.toml` (workspace deps), `crates/handshaker-core/Cargo.toml`
- Modify: `crates/handshaker-core/src/env/mod.rs`, `.../env/file_store.rs`, `.../env/in_memory.rs`
- Modify: `crates/handshaker-core/src/collections/mod.rs`, `.../collections/file_store.rs`, `.../collections/in_memory.rs`, `.../collections/resolve.rs`
- Modify: `crates/handshaker-core/src/bundle.rs`, `crates/handshaker-core/tests/collections_persistence.rs`
- Tests: new `var_order_survives_reload` in `env/file_store.rs` + `collections/file_store.rs`

**Task 2 — IPC DTOs + boundary conversions + no-drift (gate: `cargo test --workspace`, bindings diff empty, FE gate)**
- Modify: `src-tauri/Cargo.toml`, `src-tauri/src/ipc/env.rs`, `src-tauri/src/ipc/collection.rs`
- Modify: `src-tauri/src/commands/vars.rs`, `src-tauri/src/commands/collection.rs`, `src-tauri/src/commands/bundle.rs`, `src-tauri/src/commands/env.rs`
- Verify: `src/ipc/bindings.ts` unchanged

**Task 3 — hotkey predicate (gate: vitest)**
- Create: `src/features/envs/openEditor.ts`, `src/features/envs/openEditor.test.ts`

**Task 4 — wire hotkey + footer hint (gate: vitest/tsc/build)**
- Modify: `src/features/workflow/WorkflowEnvControl.tsx`, `src/features/envs/EnvSwitcherMenu.tsx`, `src/features/envs/EnvSwitcherMenu.test.tsx`

---

## Task 1: Core — flip `variables` to `IndexMap`

**Files:**
- Modify: `Cargo.toml`, `crates/handshaker-core/Cargo.toml`
- Modify: `crates/handshaker-core/src/env/mod.rs:7,19,104`
- Modify: `crates/handshaker-core/src/env/in_memory.rs:27,111,123,151`
- Modify: `crates/handshaker-core/src/collections/mod.rs:43`
- Modify: `crates/handshaker-core/src/collections/in_memory.rs:59`
- Modify: `crates/handshaker-core/src/collections/resolve.rs:24-26`
- Modify: `crates/handshaker-core/src/bundle.rs:55,68,80`
- Modify: `crates/handshaker-core/tests/collections_persistence.rs:45`
- Test: `crates/handshaker-core/src/env/file_store.rs` (new test), `crates/handshaker-core/src/collections/file_store.rs:5,107` (new test)

- [ ] **Step 1: Add the `indexmap` dependency**

In `Cargo.toml` `[workspace.dependencies]`, after the `regex = "1"` line (the "Plan #4 — Env + Vars" block), add:

```toml
# Insertion-order-preserving map for env/collection variables (round-trips order).
indexmap = { version = "2", features = ["serde"] }
```

In `crates/handshaker-core/Cargo.toml` `[dependencies]`, after `regex.workspace = true`, add:

```toml
indexmap = { workspace = true }
```

- [ ] **Step 2: Write the failing order round-trip test (env)**

In `crates/handshaker-core/src/env/file_store.rs`, inside `mod tests`, add (after `fn order_survives_reload`):

```rust
    #[test]
    fn var_order_survives_reload() {
        // Insertion order of variables must round-trip through serde (HashMap would
        // shuffle). 8 keys in a deliberately non-alphabetical order so a HashMap
        // could not pass by luck.
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("environments.json");
        let store = FileEnvironmentStore::load(path.clone()).unwrap();
        let ordered = [
            ("zeta", "1"), ("alpha", "2"), ("mu", "3"), ("beta", "4"),
            ("kappa", "5"), ("delta", "6"), ("iota", "7"), ("nu", "8"),
        ];
        store.upsert(env("prod", &ordered)).unwrap();
        drop(store);
        let store2 = FileEnvironmentStore::load(path).unwrap();
        let keys: Vec<String> = store2.get("prod").unwrap().variables.keys().cloned().collect();
        assert_eq!(keys, ordered.iter().map(|(k, _)| k.to_string()).collect::<Vec<_>>());
    }
```

- [ ] **Step 3: Write the failing order round-trip test (collection)**

In `crates/handshaker-core/src/collections/file_store.rs`, inside `mod tests`, add:

```rust
    #[test]
    fn var_order_survives_reload() {
        let dir = tempfile::tempdir().unwrap();
        let store = FileCollectionStore::load(dir.path().to_path_buf()).unwrap();
        let ordered = [
            ("zeta", "1"), ("alpha", "2"), ("mu", "3"), ("beta", "4"),
            ("kappa", "5"), ("delta", "6"), ("iota", "7"), ("nu", "8"),
        ];
        let mut c = coll(1, "c");
        for (k, v) in ordered {
            c.variables.insert(k.to_string(), v.to_string());
        }
        store.upsert(c).unwrap();
        drop(store);
        let store2 = FileCollectionStore::load(dir.path().to_path_buf()).unwrap();
        let keys: Vec<String> = store2
            .get(CollectionId(Uuid::from_u128(1)))
            .unwrap()
            .variables
            .keys()
            .cloned()
            .collect();
        assert_eq!(keys, ordered.iter().map(|(k, _)| k.to_string()).collect::<Vec<_>>());
    }
```

- [ ] **Step 4: Run the tests to verify they FAIL**

Run: `cargo test -p handshaker-core var_order_survives_reload`
Expected: both FAIL — the `assert_eq!` on key order mismatches (HashMap iteration order is not insertion order).

- [ ] **Step 5: Flip `Environment.variables` and fix env-side sites**

In `crates/handshaker-core/src/env/mod.rs`: replace line 7 `use std::collections::HashMap;` with `use indexmap::IndexMap;`. Change the struct field (line 19) to `pub variables: IndexMap<String, String>,`. In `mod tests` `fn env` (line 104), change `variables: HashMap::new()` to `variables: IndexMap::new()`.

In `crates/handshaker-core/src/env/in_memory.rs`: add `use indexmap::IndexMap;` near the top imports; change every `variables: HashMap::new()` (lines 27, 111, 123, 151) to `variables: IndexMap::new()`. If `HashMap` becomes unused in this file, remove its `use` (cargo warns).

`env/file_store.rs` needs no field-site change: the `env()` helper builds `variables` via `.collect()` which now infers `IndexMap`; `Default::default()` (line 111) is `IndexMap::default()`.

- [ ] **Step 6: Flip `Collection.variables` and fix collection-side sites**

In `crates/handshaker-core/src/collections/mod.rs`: add `use indexmap::IndexMap;` to the imports (KEEP `use std::collections::HashMap;` — `EffectiveRequest.metadata` at line 96 stays `HashMap`). Change the `Collection.variables` field (line 43) to `pub variables: IndexMap<String, String>,`.

In `crates/handshaker-core/src/collections/in_memory.rs:59`: change `variables: HashMap::new()` to `variables: IndexMap::new()`; add `use indexmap::IndexMap;` (keep `HashMap` if the store map uses it).

In `crates/handshaker-core/src/collections/file_store.rs`: add `use indexmap::IndexMap;` (KEEP `use std::collections::HashMap;` at line 5 — the store's `inner` map at line 20 stays `HashMap`). In `mod tests` `fn coll` (line 107), change `variables: HashMap::new()` to `variables: IndexMap::new()`.

In `crates/handshaker-core/tests/collections_persistence.rs:45`: change `variables: HashMap::new()` to `variables: IndexMap::new()`; add `use indexmap::IndexMap;` (and an `indexmap` dev/normal dep is already available transitively via handshaker-core — if the integration test can't see it, add `indexmap = { workspace = true }` to `[dev-dependencies]` of `crates/handshaker-core/Cargo.toml`).

- [ ] **Step 7: Convert at the resolve boundary (engine stays on `&HashMap`)**

In `crates/handshaker-core/src/collections/resolve.rs`, replace the variable block (lines 24-26) with:

```rust
    // VariableSet borrows `&HashMap` (resolution is order-agnostic). The stored
    // maps are now IndexMap, so convert here — the maps are tiny.
    let env_vars: HashMap<String, String> = active_env
        .map(|e| e.variables.iter().map(|(k, v)| (k.clone(), v.clone())).collect())
        .unwrap_or_default();
    let collection_vars: HashMap<String, String> =
        collection.variables.iter().map(|(k, v)| (k.clone(), v.clone())).collect();
    let vars = VariableSet { env: &env_vars, collection: &collection_vars };
```

(Keep `use std::collections::HashMap;` at the top — still used here and for `metadata`. The test helpers at lines 88/98 use `.collect()` and now infer `IndexMap` — no change.)

- [ ] **Step 8: Fix bundle test helpers**

In `crates/handshaker-core/src/bundle.rs` `mod tests`: replace `use std::collections::HashMap;` (line 55) with `use indexmap::IndexMap;`. Change `variables: HashMap::new()` at lines 68 and 80 to `variables: IndexMap::new()`.

- [ ] **Step 9: Run the full core suite — verify GREEN**

Run: `cargo test -p handshaker-core`
Expected: PASS, including the two new `var_order_survives_reload` tests. If cargo reports any other `variables:` site expecting `HashMap`, change it (`HashMap::new()` → `IndexMap::new()`, or add `.into_iter().collect()` if converting an owned `HashMap`) and re-run.

- [ ] **Step 10: Commit**

```bash
git add Cargo.toml crates/handshaker-core
git commit -m "feat(core): order-preserving env/collection variables via IndexMap

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: IPC DTOs + boundary conversions + bindings no-drift

**Files:**
- Modify: `src-tauri/Cargo.toml:40` (specta feature) + add `indexmap` dep
- Modify: `src-tauri/src/ipc/env.rs:3,12`
- Modify: `src-tauri/src/ipc/collection.rs:224,325,394`
- Modify: `src-tauri/src/commands/vars.rs:28-32,40-42,109`
- Modify: `src-tauri/src/commands/collection.rs:54,257,346`
- Modify: `src-tauri/src/commands/bundle.rs` (all `variables: HashMap::new()`)
- Modify: `src-tauri/src/commands/env.rs:112,127,133`
- Verify: `src/ipc/bindings.ts` unchanged

- [ ] **Step 1: Add `indexmap` dep + specta `indexmap` feature**

In `src-tauri/Cargo.toml` `[dependencies]`: change line 40 to

```toml
specta = { workspace = true, features = ["indexmap"] }
```

and add (after `specta-typescript = { workspace = true }`):

```toml
indexmap = { workspace = true }
```

- [ ] **Step 2: Flip the IPC DTO fields**

In `src-tauri/src/ipc/env.rs`: replace line 3 `use std::collections::HashMap;` with `use indexmap::IndexMap;`. Change the field (line 12) to `pub variables: IndexMap<String, String>,`. (The two `From` impls do `variables: e.variables` — both sides are now `IndexMap`, so they compile unchanged.)

In `src-tauri/src/ipc/collection.rs`: add `use indexmap::IndexMap;` (keep `HashMap` if used elsewhere in the file). Change the `CollectionIpc.variables` field (line 224) to `pub variables: IndexMap<String, String>,`. In `mod tests`, change `variables: HashMap::new()` at lines 325 and 394 to `variables: IndexMap::new()`. (The `from_core`/`into_core` impls do `variables: c.variables` / `variables: self.variables` — unchanged.)

- [ ] **Step 3: Convert the resolve-context store arms**

In `src-tauri/src/commands/vars.rs`, in `vars_resolve_impl`, the store-lookup arms now yield `IndexMap`; `VariableSet` needs `&HashMap`. Add a type annotation and convert. Replace the `env_owned` block (lines 23-33) so the `None` arm ends with `.map(|e| e.variables.into_iter().collect())` and annotate the binding `let env_owned: HashMap<String, String> = ...`. Replace the `collection_owned` block (lines 34-43) the same way: `.map(|c| c.variables.into_iter().collect())` with `let collection_owned: HashMap<String, String> = ...`. The `Some(vars)` overlay arms are already `HashMap` (from `VarsResolveCtxIpc`) — leave them. Add `use std::collections::HashMap;` to the file's imports if not present.

In `mod tests` of the same file, line 109 builds a `Collection { ... variables: map(...) }`; `map()` returns `HashMap` but the field is now `IndexMap`. Change that line to:

```rust
                variables: map(&[("uri-root", "{{notes-api-root}}")]).into_iter().collect(),
```

(Leave the `collection_vars`/`env_vars` overlay usages of `map(...)` alone — those fields are `Option<HashMap>`.)

- [ ] **Step 4: Flip `collection_set_variables` to `IndexMap`**

In `src-tauri/src/commands/collection.rs`: add `use indexmap::IndexMap;` (keep `HashMap` if used elsewhere). Change `collection_set_variables_impl` (line 54) param to `vars: IndexMap<String, String>` and the `#[tauri::command]` `collection_set_variables` (line 257) param to `vars: IndexMap<String, String>`. In `mod tests`, change `variables: HashMap::new()` (line 346) to `variables: IndexMap::new()`.

- [ ] **Step 5: Fix remaining src-tauri construction sites**

In `src-tauri/src/commands/bundle.rs` (`mod tests`): add `use indexmap::IndexMap;` and change every `variables: HashMap::new()` (lines 150, 170, 171, 177, 199, 221, 303, 306, 313, 316) to `variables: IndexMap::new()`. (Line 238 uses `.collect()` and infers `IndexMap` — no change.)

In `src-tauri/src/commands/env.rs` (`mod tests`): replace `use std::collections::HashMap;` (line 112) with `use indexmap::IndexMap;`, and change `let mut map = HashMap::new();` (line ~127, in `build_state`) to `let mut map = IndexMap::new();`. (Line 148 uses the fully-qualified `std::collections::HashMap::new()` for `in_flight`, so it does not need the import.)

`src-tauri/src/state.rs` lines 138/168 use `variables: Default::default()` — `IndexMap: Default`, so NO change.

- [ ] **Step 6: Run the full workspace suite — verify GREEN**

Run: `cargo test --workspace`
Expected: PASS. If cargo reports any other `variables:` site, fix it the same way and re-run.

- [ ] **Step 7: Regenerate bindings and assert no drift**

Run:
```bash
cargo run -p handshaker --bin export-bindings --features export-bindings
git diff --exit-code src/ipc/bindings.ts && echo "NO DRIFT"
```
Expected: exit 0, prints `NO DRIFT` (specta maps `IndexMap<String,String>` to the same `Partial<Record<string, string>>` as `HashMap`). If `bindings.ts` DID change to a non-`Record` shape, STOP — the IndexMap-emits-Record assumption is wrong; fall back to the explicit `order: Vec<String>` field documented in the spec's alternative. If it changed but is still `Record`-shaped (equivalent), commit the regeneration.

- [ ] **Step 8: Confirm the frontend is unaffected**

Run: `pnpm lint && pnpm test && pnpm build`
Expected: tsc clean, vitest all pass, vite build OK (no frontend code changed for ordering).

- [ ] **Step 9: Commit**

```bash
git add src-tauri src/ipc/bindings.ts
git commit -m "feat(ipc): carry IndexMap variables through the IPC boundary (no bindings drift)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: `isEnvEditHotkey` predicate

**Files:**
- Create: `src/features/envs/openEditor.ts`
- Test: `src/features/envs/openEditor.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/features/envs/openEditor.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { isEnvEditHotkey } from "./openEditor";

// Minimal event shape the predicate inspects.
const ev = (over: Partial<KeyboardEvent>): Pick<
  KeyboardEvent,
  "code" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey"
> => ({ code: "KeyE", ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...over });

describe("isEnvEditHotkey", () => {
  it("matches Ctrl+Shift+E (physical KeyE)", () => {
    expect(isEnvEditHotkey(ev({ ctrlKey: true, shiftKey: true }))).toBe(true);
  });
  it("matches Cmd+Shift+E", () => {
    expect(isEnvEditHotkey(ev({ metaKey: true, shiftKey: true }))).toBe(true);
  });
  it("rejects Ctrl+E without Shift (that is the cycle hotkey)", () => {
    expect(isEnvEditHotkey(ev({ ctrlKey: true }))).toBe(false);
  });
  it("rejects when Alt is held (AltGr = Ctrl+Alt on euro layouts)", () => {
    expect(isEnvEditHotkey(ev({ ctrlKey: true, shiftKey: true, altKey: true }))).toBe(false);
  });
  it("rejects a different physical key", () => {
    expect(isEnvEditHotkey(ev({ ctrlKey: true, shiftKey: true, code: "KeyK" }))).toBe(false);
  });
  it("rejects Shift+E without a modifier", () => {
    expect(isEnvEditHotkey(ev({ shiftKey: true }))).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it FAILS**

Run: `pnpm test -- openEditor`
Expected: FAIL — `isEnvEditHotkey` is not defined / module not found.

- [ ] **Step 3: Implement the predicate**

Create `src/features/envs/openEditor.ts`:

```ts
/**
 * Ctrl+Shift+E "open Edit environment" hotkey helper. Pure + unit-tested; the
 * keydown listener lives in {@link WorkflowEnvControl}. Mirror of {@link isEnvCycleHotkey}
 * (cycle.ts) — physical key, layout-independent — but requires Shift, so it never
 * collides with the Shift-less Ctrl+E cycle.
 */

/** Предикат «open Edit environment»: Ctrl/Cmd+Shift+E по ФИЗИЧЕСКОЙ клавише E
 *  (`e.code === "KeyE"`, раскладко-независимо), с Shift, без Alt (AltGr = Ctrl+Alt). */
export function isEnvEditHotkey(
  e: Pick<KeyboardEvent, "code" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey">,
): boolean {
  if (e.altKey) return false; // AltGr prints symbols on euro layouts
  if (!e.shiftKey) return false; // Shift distinguishes edit from the Ctrl+E cycle
  if (!e.ctrlKey && !e.metaKey) return false;
  return e.code === "KeyE";
}
```

- [ ] **Step 4: Run the test to verify it PASSES**

Run: `pnpm test -- openEditor`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/features/envs/openEditor.ts src/features/envs/openEditor.test.ts
git commit -m "feat(envs): isEnvEditHotkey predicate (Ctrl+Shift+E)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: Wire the hotkey + footer hint

**Files:**
- Modify: `src/features/workflow/WorkflowEnvControl.tsx:9,77-88`
- Modify: `src/features/envs/EnvSwitcherMenu.tsx:14,137-144`
- Test: `src/features/envs/EnvSwitcherMenu.test.tsx`

- [ ] **Step 1: Write the failing footer-hint test**

In `src/features/envs/EnvSwitcherMenu.test.tsx`, add a test asserting the menu renders BOTH the cycle hint and the new edit hint. The menu content is in a Radix dropdown — follow the existing test's pattern for opening it (click the trigger), then assert the text. Add:

```tsx
  it("shows the Edit-environment hotkey hint in the footer", async () => {
    renderMenu(); // existing helper that renders EnvSwitcherMenu with a trigger
    await openMenu(); // existing helper that clicks the trigger to open the dropdown
    expect(screen.getByText("Edit environment")).toBeInTheDocument();
    expect(screen.getByText("Cycle environment")).toBeInTheDocument();
  });
```

If the existing test file has no `renderMenu`/`openMenu` helpers, inline the render + a `fireEvent.click` on the trigger button (match the file's existing setup), then assert the two texts.

- [ ] **Step 2: Run the test to verify it FAILS**

Run: `pnpm test -- EnvSwitcherMenu`
Expected: FAIL — "Edit environment" text not found.

- [ ] **Step 3: Add the footer hint to EnvSwitcherMenu**

In `src/features/envs/EnvSwitcherMenu.tsx`, replace the single footer hint block (lines 138-144) with two stacked hint rows:

```tsx
          {/* Non-interactive footer hints for the global env hotkeys (wired in
              WorkflowEnvControl). Keycap glyphs are aria-hidden; labels carry meaning. */}
          <div className="flex items-center justify-between px-2 py-1 text-[10px] text-muted-foreground/70">
            <span>Cycle environment</span>
            <span aria-hidden>{isMacOS ? "⌘E" : "Ctrl+E"}</span>
          </div>
          <div className="flex items-center justify-between px-2 py-1 text-[10px] text-muted-foreground/70">
            <span>Edit environment</span>
            <span aria-hidden>{isMacOS ? "⇧⌘E" : "Ctrl+Shift+E"}</span>
          </div>
```

- [ ] **Step 4: Run the test to verify it PASSES**

Run: `pnpm test -- EnvSwitcherMenu`
Expected: PASS.

- [ ] **Step 5: Wire the keydown listener in WorkflowEnvControl**

In `src/features/workflow/WorkflowEnvControl.tsx`: extend the import on line 9 to also bring in the predicate:

```tsx
import { isEnvCycleHotkey, nextEnvName } from "@/features/envs/cycle";
import { isEnvEditHotkey } from "@/features/envs/openEditor";
```

Immediately after the existing cycle `useEffect` (ends at line 88), add a second effect:

```tsx
  // Global Ctrl+Shift+E / Cmd+Shift+E opens Edit environment for the active env
  // (no active env → create mode). Same capture-phase + stopPropagation discipline
  // as the cycle hotkey so a focused Monaco editor never sees the key.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat || !isEnvEditHotkey(e)) return;
      e.preventDefault();
      e.stopPropagation();
      setEditor({ originalName: activeEnv });
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [activeEnv]);
```

(`activeEnv` is `wf.envName` — a `string | null`; `null` opens the dialog in create mode, matching `EnvEditorDialog`'s `originalName === null` contract.)

- [ ] **Step 6: Run the FE gate — verify GREEN**

Run: `pnpm lint && pnpm test && pnpm build`
Expected: tsc clean, vitest all pass (incl. the new hint test), vite build OK.

- [ ] **Step 7: Commit**

```bash
git add src/features/workflow/WorkflowEnvControl.tsx src/features/envs/EnvSwitcherMenu.tsx src/features/envs/EnvSwitcherMenu.test.tsx
git commit -m "feat(envs): Ctrl+Shift+E opens Edit environment + footer hint

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:**
- "Порядок переменных → IndexMap (env + collection)" → Tasks 1–2. ✓
- "Движок резолва нетронут (конвертация на границе)" → Task 1 Step 7 (`resolve.rs`) + Task 2 Step 3 (`vars.rs`); `vars/mod.rs` not edited. ✓
- "Каждый персистящий vars IPC-нос → IndexMap" → Task 2 Steps 2 (`EnvironmentIpc`, `CollectionIpc`) + 4 (`collection_set_variables`); overlay `VarsResolveCtxIpc` left as `HashMap`. ✓
- "Порядок едет с экспортом / merge сохраняет порядок" → covered by `IndexMap` round-trip + bundle merge `insert` semantics (existing import tests stay green); explicit env order test is the file-store one. ✓
- "specta indexmap feature, no bindings drift" → Task 2 Steps 1 + 7. ✓
- "Хоткей Ctrl+Shift+E (active env / create), footer hint" → Tasks 3–4. ✓
- Known limit (integer-keys) → documented in spec; no code. ✓

**Placeholder scan:** Each code step shows the actual code; migration steps enumerate exact files/lines and rely on `cargo` to flag any missed mechanical site (legitimate for a type migration, not a vague TODO). ✓

**Type consistency:** `isEnvEditHotkey` signature identical across Task 3 (def) and Task 4 (import/use). `variables: IndexMap<String,String>` used consistently for `Environment`, `Collection`, `EnvironmentIpc`, `CollectionIpc`, and the `collection_set_variables` param. `VariableSet` remains `&HashMap` and is fed converted owned `HashMap`s. ✓

## Out of scope
- Drag-reorder of variable rows; `metadata` ordering; a visible open button (hotkey only) — per spec.
