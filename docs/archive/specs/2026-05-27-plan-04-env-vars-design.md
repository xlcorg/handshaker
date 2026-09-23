# Plan #4 — Env + Vars (Design)

**Date:** 2026-05-27
**Branch (suggested):** `claude/plan-04-env-vars`
**Realizes spec rules:**
- Master §5.2 (Environment + Variables — data model, resolver semantics, priority).
- Master §6.2 (`env_*`, `vars_resolve` IPC contract).
- Master §8.8 (variable highlight color in editor).
- Master §9 (env-pill in header).
- Plan #3 UI Polish §1 deferrals — `{{var}}` substitution, `{{var}}` syntax highlighting, "resolves: ..." preview line, env-pill in header.

## 0. Sources and prior documents

This document **extends** the master spec, not duplicates it. Master is authoritative on conflicts.

- Master spec: [`2026-05-26-handshaker-mvp-design.md`](2026-05-26-handshaker-mvp-design.md) — §5.2 (env+var model), §6.2/§6.3 (IPC), §8.1 (header), §8.4 (request view), §8.8 (visual style).
- Plan #3 design: [`2026-05-27-plan-03-dynamic-invoke-design.md`](2026-05-27-plan-03-dynamic-invoke-design.md) — `invoke_unary` signature this plan layers onto.
- Plan #3 UI Polish design: [`2026-05-27-plan-03-ui-polish-design.md`](2026-05-27-plan-03-ui-polish-design.md) — §1 explicit deferral list.
- Plan #3 UI Polish errata: [`../errata/2026-05-27-plan-03-ui-polish.md`](../errata/2026-05-27-plan-03-ui-polish.md) — Plan #4 inherits all 6 deviations (Postman-style tabs, status placement, Monaco lazy-bundle, Send hotkey).
- Existing `CoreError::UnresolvedVariable { name }` and `CoreError::VariableCycle { chain }` are pre-wired in Plan #1 ([`crates/handshaker-core/src/error.rs`](../../../crates/handshaker-core/src/error.rs)). Plan #4 produces and propagates them — no `CoreError` / `IpcError` changes.

## 1. Goal and scope

**Goal:** end-to-end `{{var}}` workflow for the request body editor — resolver in core, Monaco syntax highlighting, env state in Tauri, env-pill in header, live "Resolves: …" preview, and wired `UnresolvedVariable` / `VariableCycle` errors.

**Acceptance:** in the running app, the user opens the env dialog, defines `{ uid = "abc-123" }` under Default env, picks a method, types `{"user_id":"{{uid}}"}` in the body editor, sees `{{uid}}` highlighted in warm yellow, sees a live preview line "→ resolves: `{"user_id":"abc-123"}`" below the editor, clicks Send and the server receives the resolved JSON. Erasing the variable definition turns the preview red with "⚠ Unresolved: uid" and blocks Send with an inline toast.

### 1.1 In scope

1. `vars/` module in `handshaker-core` — `Environment`, `VariableSet`, `resolve_string` (strict), `resolve_template_with_diagnostics` (non-failing).
2. `env/` module in `handshaker-core` — `Environment`, `EnvironmentStore` trait, `InMemoryEnvironmentStore` with active-env tracking.
3. Tauri state extension — `env_store` + `active_env`; bootstrap a `"Default"` env at startup.
4. IPC commands — `env_list`, `env_active_get`, `env_active_set`, `env_upsert`, `vars_resolve`. No events in Plan #4 (see §5.2).
5. Frontend `EnvPill` in header + `EditEnvDialog` for editing the active env's variables.
6. Monaco custom language `json-with-vars` with `{{[a-zA-Z_][a-zA-Z0-9_-]*}}` token rule and warm-yellow theme color.
7. `ResolvesPreview` single-line component below the body editor (debounced `vars_resolve`).
8. Send flow runs `vars_resolve` synchronously before `grpc_invoke_unary`; aborts with inline toast on errors.

### 1.2 Out of scope (explicit deferrals)

- **JSON schema validation in Monaco from `prost-reflect` descriptors** — separate sub-plan (Plan #4b or similar). Confirmed user decision during brainstorm.
- **Multiple environments + switcher dropdown.** Master §4 line 137: "одна «Default» env в MVP". The header pill shows `Default ▾` for visual consistency with the future switcher, but clicking it opens the variable editor, not a switcher.
- **Env CRUD (create / rename / delete envs).** Only the bootstrap `Default` env exists.
- **Variables at Collection scope.** `VariableSet { env, collection }` exists in the resolver API, but `collection` is hardcoded to an empty map until Plan #6 introduces `Collection`.
- **`SavedRequest.address_template` and `{{var}}` in the ConnectPanel address.** No `SavedRequest` concept exists until Plan #6; the current ConnectPanel address remains a raw `host:port` input. Master §5.5 / §8.4 address-bar `{{var}}` lands with the request view rebuild.
- **Persistence to disk** for envs. Master §4 line 148: in-memory only in MVP.
- **`env_delete` IPC command.** With only one Default env, deletion is moot; reintroduced when multi-env arrives.
- **Custom Monaco theme rewrite.** We keep `vs-dark` as the base and only add one token color via `defineTheme` extension.

## 2. Architecture — three layers

### 2.1 Core (`crates/handshaker-core/src/`)

```
vars/
  mod.rs    NEW  — VariableSet, ResolutionReport, resolve_string,
                   resolve_template_with_diagnostics, MAX_PASSES const
  tests.rs  NEW  — env-only / collection-only / priority / cycle /
                   recursive / MAX_PASSES exhaustion / non-failing variant
env/
  mod.rs        NEW  — Environment value type, EnvironmentStore trait
  in_memory.rs  NEW  — InMemoryEnvironmentStore (RwLock<HashMap<String, Environment>>)
                       + active_name (RwLock<String>); thread-safe; default-bootstrap
lib.rs        MODIFY — pub re-exports: vars, env
error.rs      UNCHANGED — UnresolvedVariable / VariableCycle already present
```

**Invariants:**
- `vars/mod.rs` knows nothing about env storage or active env — it takes a `VariableSet<'a>` borrow.
- `env/in_memory.rs` exposes only `EnvironmentStore` + a constructor; the `active_env` notion lives in Tauri state (it's a session concept, not a core concept).
- Resolver public API is the **only** way to substitute `{{var}}` in core. Frontend never reimplements the regex.

### 2.2 src-tauri

```
src/
  state.rs        MODIFY — add `env_store: Arc<dyn EnvironmentStore>`,
                           `active_env: RwLock<String>`. Constructor seeds a
                           "Default" env with empty variables.
  ipc/
    env.rs        NEW    — EnvironmentIpc + From<Environment> + Into<Environment>
    vars.rs       NEW    — ResolutionReportIpc + From<ResolutionReport>
    mod.rs        MODIFY — pub use new modules
  commands/
    env.rs        NEW    — #[tauri::command] env_list, env_active_get,
                           env_active_set, env_upsert
    vars.rs       NEW    — #[tauri::command] vars_resolve
    mod.rs        MODIFY — pub mod env; pub mod vars;
  lib.rs          MODIFY — register new commands in
                           tauri_specta::collect_commands![],
                           include in invoke_handler
```

**No new events in Plan #4.** Master §6.3 lists `ActiveEnvChanged`, but with a single Default env there is no switcher and `env_active_set` is never called from the UI. The event lands when multi-env arrives (Plan #4b or Plan #6) — YAGNI for now.

### 2.3 Frontend (`src/`)

```
src/
  lib/
    monaco.ts                 MODIFY — register "json-with-vars" language +
                                       extend "handshaker-dark" theme
  features/
    envs/                     NEW directory
      EnvPill.tsx             NEW   — ghost-button in header
      EditEnvDialog.tsx       NEW   — shadcn Dialog + key/value table
      VariablesTable.tsx      NEW   — extracted table component (key|value|x)
    invoke/
      InvokePanel.tsx         MODIFY — render <ResolvesPreview> under Monaco,
                                       gate Send via vars_resolve
      ResolvesPreview.tsx     NEW   — debounced single-line preview component
      BodyEditor.tsx          MODIFY — switch defaultLanguage from "json" to "json-with-vars"
  components/ui/
    dialog.tsx                NEW   — shadcn add dialog (if absent)
  ipc/
    client.ts                 MODIFY — typed wrappers for env_*, vars_resolve
    bindings.ts               REGEN  — via export-bindings binary
  App.tsx                     MODIFY — header gets <EnvPill>; on mount loads
                                       active env name + variables into local state
```

No Zustand introduction in Plan #4 (KISS — single component tree, React `useState` is sufficient). Zustand lands when multi-window or multi-tab state appears (probably Plan #6 with Collections).

## 3. Data types

### 3.1 Core

```rust
// vars/mod.rs

use std::collections::HashMap;
use crate::error::CoreError;

pub const MAX_PASSES: usize = 4;

pub struct VariableSet<'a> {
    pub env: &'a HashMap<String, String>,
    pub collection: &'a HashMap<String, String>,
}

#[derive(Debug, Clone)]
pub struct ResolutionReport {
    /// Best-effort substitution result. Unresolved `{{var}}` placeholders are left as-is.
    pub resolved: String,
    /// Variable names that were referenced but absent from both env and collection.
    /// Deduplicated, ordered by first appearance in the template.
    pub unresolved_vars: Vec<String>,
    /// When a cycle is detected, the chain that led to it (e.g. `["a", "b", "a"]`).
    /// `Some` if and only if substitution did not converge within MAX_PASSES due to a cycle.
    pub cycle_chain: Option<Vec<String>>,
}

/// Strict resolve — for `invoke_unary` and other server-side use.
/// Fails on the first unresolved variable or cycle.
pub fn resolve_string(template: &str, vars: &VariableSet<'_>) -> Result<String, CoreError>;

/// Non-failing resolve — for UI preview.
/// Always returns a `ResolutionReport`; substitution proceeds as far as possible.
pub fn resolve_template_with_diagnostics(
    template: &str,
    vars: &VariableSet<'_>,
) -> ResolutionReport;
```

```rust
// env/mod.rs

use std::collections::HashMap;
use crate::error::CoreError;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Environment {
    pub name: String,                       // unique, [a-zA-Z_][a-zA-Z0-9_-]*
    pub variables: HashMap<String, String>,
}

pub trait EnvironmentStore: Send + Sync {
    fn list(&self) -> Vec<Environment>;
    fn get(&self, name: &str) -> Option<Environment>;
    fn upsert(&self, env: Environment) -> Result<(), CoreError>;
    fn delete(&self, name: &str) -> Result<(), CoreError>;  // present in trait;
                                                            // not exposed via IPC in Plan #4
}
```

```rust
// env/in_memory.rs

use std::sync::RwLock;
use std::collections::HashMap;

pub struct InMemoryEnvironmentStore {
    inner: RwLock<HashMap<String, Environment>>,
}

impl InMemoryEnvironmentStore {
    /// Bootstrap with a single "Default" env; used at app startup.
    pub fn with_default() -> Self;
}

impl EnvironmentStore for InMemoryEnvironmentStore { /* ... */ }
```

**Validation in `upsert`:** name regex `^[a-zA-Z_][a-zA-Z0-9_-]*$` per master §5.2 line 202. Invalid → `CoreError::InvalidTarget(format!("invalid env name: `{name}`"))` (we reuse `InvalidTarget` rather than introducing a new variant — it's the closest semantic match, and CoreError changes are out of scope).

### 3.2 IPC

```rust
// ipc/env.rs
#[derive(serde::Serialize, serde::Deserialize, specta::Type, Debug, Clone)]
pub struct EnvironmentIpc {
    pub name: String,
    pub variables: HashMap<String, String>,
}

impl From<handshaker_core::env::Environment> for EnvironmentIpc { /* trivial */ }
impl From<EnvironmentIpc> for handshaker_core::env::Environment { /* trivial */ }

// ipc/vars.rs
#[derive(serde::Serialize, specta::Type, Debug, Clone)]
pub struct ResolutionReportIpc {
    pub resolved: String,
    pub unresolved_vars: Vec<String>,
    pub cycle_chain: Option<Vec<String>>,
}

impl From<handshaker_core::vars::ResolutionReport> for ResolutionReportIpc { /* trivial */ }
```

`handshaker-core` itself stays free of `specta` — wrapper types live in `src-tauri/src/ipc/` (continuation of the Plan #2 errata #7 invariant).

## 4. Resolver semantics (precise)

Per master §5.2 lines 218-228, fully specified here:

- **Pattern:** `\{\{([a-zA-Z_][a-zA-Z0-9_-]*)\}\}` — verbatim from master. Compiled once via `once_cell::sync::Lazy<Regex>`.
- **Lookup priority:** `vars.env > vars.collection`. If a name exists in `env`, the `env` value wins regardless of whether `collection` has it.
- **Algorithm:** Up to `MAX_PASSES = 4` substitution passes. Each pass walks all matches and replaces the ones that resolve. A pass that performs zero replacements exits the loop.
- **Termination & errors:**
  - After loop exit, scan the final string for any remaining `{{name}}` matches.
  - If the loop exited because zero replacements happened **and** unresolved names remain → those names are *missing variables*: `unresolved_vars`.
  - If the loop exited because `MAX_PASSES` was exhausted (a pass *did* perform replacements on every iteration but unresolved matches remain) → assume a cycle. Compute the cycle chain by following the substitution graph (see §4.1 below).
- **`resolve_string` (strict):**
  - If `cycle_chain.is_some()` → `Err(CoreError::VariableCycle { chain })`.
  - Else if `unresolved_vars` non-empty → `Err(CoreError::UnresolvedVariable { name })` for the **first** unresolved name (matches master §5.2 line 226).
  - Else → `Ok(resolved)`.
- **`resolve_template_with_diagnostics` (preview):**
  - Always returns `ResolutionReport`. Never panics, never errors. `resolved` is the best-effort partial substitution string with surviving `{{var}}` placeholders left visible.

### 4.1 Cycle chain construction

When the loop exhausts `MAX_PASSES`, the resolver computes a chain by:
1. Collecting all variable names that still appear unresolved in the final string.
2. Building a directed graph `name → references_within_its_value` from `env ∪ collection` definitions.
3. Running DFS from each unresolved name; the first back-edge defines the cycle. Format: `["a", "b", "a"]` (start node repeated at end), matching master §5.1 `VariableCycle::chain` display test.
4. If multiple cycles exist, return the one rooted at the lexicographically first unresolved name (determinism for tests).

This is more work than a naive "just report the remaining `{{x}}` names" but makes the error message actionable — users see `Cycle: a → b → a`, not `Unresolved: a`.

### 4.2 Properties (asserted via tests)

| Property | Tested in |
|---|---|
| `resolve_string("hello", &empty) → "hello"` | `vars::tests::no_vars_passthrough` |
| Single substitution: `"{{x}}"` with `{x="1"}` → `"1"` | `single_pass` |
| Priority: `env.x="env"`, `coll.x="coll"`, `"{{x}}"` → `"env"` | `env_overrides_collection` |
| Chained: `env={a="{{b}}", b="2"}`, `"{{a}}"` → `"2"` (in ≤2 passes) | `chained_two_pass` |
| Deep chain within MAX_PASSES: 3 hops resolves | `chain_three_hops` |
| Cycle a→b→a: `env={a="{{b}}", b="{{a}}"}`, `"{{a}}"` → `VariableCycle` | `cycle_two_node` |
| Self-cycle: `env={a="{{a}}"}`, `"{{a}}"` → `VariableCycle` chain `["a", "a"]` | `cycle_self` |
| Unresolved: `"{{missing}}"` empty vars → `UnresolvedVariable { name: "missing" }` | `unresolved_single` |
| Multiple unresolved (diagnostics): `"{{a}} {{b}}"` empty vars → `unresolved_vars == ["a", "b"]` | `diagnostics_collects_all` |
| Mixed unresolved + cycle (diagnostics): cycle wins reporting | `diagnostics_cycle_priority` |
| Invalid `{{1bad}}` is **not** matched by regex — left as literal text | `invalid_name_left_alone` |

## 5. IPC contract

### 5.1 Commands

| Command | Args | Return |
|---|---|---|
| `env_list` | — | `Vec<EnvironmentIpc>` |
| `env_active_get` | — | `String` (env name) |
| `env_active_set` | `name: String` | `()` |
| `env_upsert` | `env: EnvironmentIpc` | `()` |
| `vars_resolve` | `template: String` | `ResolutionReportIpc` (resolves against active env's variables + empty collection map) |

**Notes:**
- `env_active_set` validates that the env exists in the store; missing → `IpcError::InvalidTarget(...)` (mapped from `CoreError::InvalidTarget`). The command is **shipped but unused** by the UI in Plan #4 (no switcher to call it from); it exists so multi-env work can land cleanly later.
- `env_upsert` is **upsert**: missing name creates, existing name replaces variables wholesale (no per-key merge — frontend sends the full updated map).
- `vars_resolve` is debounced on the frontend (300 ms typing settle) but the backend has no rate limit; concurrent calls are cheap (single in-memory pass).

### 5.2 Events

**None added in Plan #4.** Cross-component fan-out is not needed: the EditEnvDialog updates its local state directly from its own `env_upsert` reply, and InvokePanel reads variables only indirectly via `vars_resolve` per keystroke. `ActiveEnvChanged` arrives with the switcher.

### 5.3 Error mapping

All paths use existing `CoreError` → `IpcError` mapping (Plan #1). New IPC errors expected:
- `vars_resolve` → `resolve_template_with_diagnostics` never errors; command returns `Ok(ResolutionReportIpc)` even with `unresolved_vars` non-empty. Errors are **data**, not control flow, here.
- `env_active_set("nonexistent")` → `CoreError::InvalidTarget(...)` → `IpcError::InvalidTarget { message }`.

## 6. UI surface

### 6.1 Header — `EnvPill`

```
┌──────────────────────────────────────────────────────────┐
│  Handshaker                              Default ▾        │
└──────────────────────────────────────────────────────────┘
```

- Ghost button, right-aligned via flex.
- Label: active env name (loaded via `env_active_get` on mount) + `▾` chevron icon (`lucide-react ChevronDown`).
- Click → opens `EditEnvDialog` for the active env.
- The dropdown chevron is a visual hint for the future switcher (Plan #4b or Plan #6). It is not misleading per the memory rule `feedback_ui_transparent_mechanics`: this is *not* an indicator of engine state (cache / inheritance / auth) — it's standard affordance signaling that the pill is interactive.

### 6.2 `EditEnvDialog`

shadcn `Dialog` (added via `pnpm dlx shadcn@latest add dialog` if absent).

```
┌─ Edit variables — Default ────────────────────── × ┐
│                                                    │
│  ┌──────────────┬──────────────────────┬──┐        │
│  │ key          │ value                │  │        │
│  ├──────────────┼──────────────────────┼──┤        │
│  │ uid          │ abc-123              │ ✕│        │
│  │ env_label    │ production           │ ✕│        │
│  │ Add variable │                      │  │        │
│  └──────────────┴──────────────────────┴──┘        │
│                                                    │
│                              [ Cancel ] [ Save ]   │
└────────────────────────────────────────────────────┘
```

- Empty-row at the bottom with `Add variable` placeholder on the key input; typing into it materializes a new row.
- Key validation: regex `^[a-zA-Z_][a-zA-Z0-9_-]*$`. Invalid → red `--destructive` border on the input, no inline error text (the regex constraint is shown in a tooltip via `title` attribute).
- Duplicate key: small warning text under the row "duplicate — last value wins"; resolver picks the last per `HashMap` semantics.
- Delete (`✕`): only visible on row hover; hidden on the empty-row.
- `Cancel`: discards changes, closes dialog.
- `Save`: calls `env_upsert` with the full updated `EnvironmentIpc`, closes on success. Failure → inline red-text error strip at the dialog footer (above the buttons), dialog stays open. The dialog owns its own error state — we do **not** introduce `sonner` (not currently a dependency) and we do **not** route through `App`'s `onError` (that surface is owned by the InvokePanel/Response area).
- No unsaved-changes guard — clicking outside or hitting `Esc` discards (consistent with KISS).

### 6.3 `InvokePanel` — `ResolvesPreview`

```
┌─ InvokePanel ──────────────────────────────────────┐
│  test.Echo / Send                  [ Send ⌘↵ ]     │
│  ┌────────────────────────────────────────────┐    │
│  │ {                                          │    │
│  │   "user_id": "{{uid}}"   ← {{uid}} yellow │    │
│  │ }                                          │    │
│  └────────────────────────────────────────────┘    │
│  → resolves: {"user_id":"abc-123"}                  │
└────────────────────────────────────────────────────┘
```

- One-line component below Monaco, monospace, `text-muted-foreground`.
- Truncate-with-ellipsis on overflow (`overflow-hidden text-ellipsis whitespace-nowrap`); on hover show full via `title` attribute.
- Three render states:
  1. **No `{{...}}` in body** → component renders nothing (no noise).
  2. **Successful resolve** → `→ resolves: <inline JSON, single-line collapsed>`.
  3. **Errors** → `⚠ Unresolved: uid, foo` or `⚠ Cycle: a → b → a`, color `text-destructive`.
- Debounce: 300 ms after last keystroke; cancellable on unmount or method-change.
- The single-line JSON view collapses whitespace (newlines → space, sequences of spaces → one space) for display purposes only — `vars_resolve` always returns the verbatim resolved text.

### 6.4 Send flow modifications

```ts
async function handleSend() {
  // Existing JSON.parse guard from Plan #3 still runs first.
  try { JSON.parse(body); }
  catch (e) { onError(`Invalid JSON: ${(e as Error).message}`); return; }

  let resolved: string;
  try {
    const report = await ipc.varsResolve(body);
    if (report.unresolved_vars.length > 0) {
      onError(`Unresolved variables: ${report.unresolved_vars.join(", ")}`);
      return;
    }
    if (report.cycle_chain) {
      onError(`Variable cycle: ${report.cycle_chain.join(" → ")}`);
      return;
    }
    resolved = report.resolved;
  } catch (e) {
    const tagged = e as { type?: string; message?: string };
    onError(tagged.message ?? tagged.type ?? "resolve failed");
    return;
  }

  setBusy(true);
  try {
    const outcome = await ipc.grpcInvokeUnary({
      service: selected.service,
      method: selected.method,
      request_json: resolved,
      metadata: {},
    });
    onOutcome(outcome);
  } catch (e) {
    const tagged = e as { type?: string; message?: string };
    onError(tagged.message ?? tagged.type ?? "invoke failed");
  } finally {
    setBusy(false);
  }
}
```

`grpc_invoke_unary` is **unchanged**: it receives an already-resolved JSON string. This keeps `invoke_unary` single-purpose and lets `vars_resolve` be the sole substitution path (preview and send share the same code). Errors flow through the existing `onError` callback from Plan #3 — `App.tsx` already renders these as an inline red-text strip in the Response area in place of `<ResponsePanel>` (see `src/App.tsx` lines 99–109). No new error-display infrastructure is added in Plan #4.

### 6.5 Visual style

- Variable token color: `#FACC15` (close to master §8.8 `oklch(0.78 0.16 80)`), `fontStyle: "bold"`. Theme rule applied via `monaco.editor.defineTheme("handshaker-dark", { base: "vs-dark", inherit: true, rules: [...] })`. We switch BodyEditor / BodyView to use `theme="handshaker-dark"` instead of `vs-dark`.
- Resolved preview color: default `--muted-foreground` (no special tint — readable but not screaming).
- Error preview color: `--destructive`.
- EnvPill: `Button variant="ghost" size="sm"`, no special background.

## 7. Monaco custom language

### 7.1 Registration

In `src/lib/monaco.ts`, after the existing `loader.config({ monaco })` call:

```ts
monaco.languages.register({ id: "json-with-vars" });

monaco.languages.setLanguageConfiguration("json-with-vars", {
  // Same as JSON: brackets / autoClosingPairs / comments.
  brackets: [["{", "}"], ["[", "]"]],
  autoClosingPairs: [
    { open: "{", close: "}" }, { open: "[", close: "]" },
    { open: '"', close: '"' },
  ],
  surroundingPairs: [
    { open: "{", close: "}" }, { open: "[", close: "]" },
    { open: '"', close: '"' },
  ],
});

monaco.languages.setMonarchTokensProvider("json-with-vars", {
  // Order matters: the variable rule runs before string body matching so that
  // `"{{uid}}"` paints the inner placeholder with the variable token.
  tokenizer: {
    root: [
      [/\{\{[a-zA-Z_][a-zA-Z0-9_\-]*\}\}/, "variable.template"],
      [/"(?:[^"\\]|\\.)*"/, "string"],
      [/-?\d+(\.\d+)?([eE][+\-]?\d+)?/, "number"],
      [/\b(?:true|false|null)\b/, "keyword"],
      [/[{}\[\],:]/, "delimiter"],
      [/[ \t\r\n]+/, "white"],
    ],
  },
});

monaco.editor.defineTheme("handshaker-dark", {
  base: "vs-dark",
  inherit: true,
  rules: [
    { token: "variable.template", foreground: "FACC15", fontStyle: "bold" },
  ],
  colors: {},
});
```

### 7.2 Trade-offs

- **Loss of built-in JSON diagnostics.** The custom language has no `setDiagnosticsOptions` — invalid JSON does not get red squiggles. Acceptable because:
  1. JSON schema validation is deferred to Plan #4b regardless.
  2. The pre-Send `JSON.parse(body)` check (already present from Plan #3) gives the user immediate feedback on Send.
  3. Plan #4b will register diagnostics on `json-with-vars` directly, or replace this approach with overlay decorations on the original `json` model.
- **Grammar duplication.** We copy a minimal subset of Monaco's built-in JSON Monarch grammar. The exact JSON grammar in Monaco is more elaborate (handles unicode escapes, etc.) — our minimal version is sufficient for syntax highlighting of typical request bodies. If users complain, we revisit in Plan #4b.

### 7.3 Source verification

- Monarch DSL + `setMonarchTokensProvider` is documented at [microsoft.github.io/monaco-editor/monarch.html](https://microsoft.github.io/monaco-editor/monarch.html).
- Token names like `variable.template` are conventional Monarch token IDs; theme rules can target them via `rules: [{ token, foreground, fontStyle }]` per [monaco.editor.defineTheme API](https://microsoft.github.io/monaco-editor/typedoc/functions/editor.defineTheme.html).
- Extending an existing language tokenizer instead of creating a new one is also a valid pattern (see [extend-monaco-language-tokenizer](https://github.com/Pranomvignesh/extend-monaco-language-tokenizer)) — we deliberately create a new language ID to keep our token additions isolated and to enable future Plan #4b diagnostics on `json-with-vars` without affecting plain JSON consumers.

## 8. Error wiring

| `CoreError` | Produced by | Surface |
|---|---|---|
| `UnresolvedVariable { name }` | `resolve_string` strict mode | Plan #4 produces internally in `resolve_string`; **not** propagated to IPC (frontend uses `vars_resolve` which returns `ResolutionReport` instead). However the variant remains the canonical error for any other internal consumer that calls `resolve_string` directly. |
| `VariableCycle { chain }` | `resolve_string` strict mode | Same as above. |
| `InvalidTarget(msg)` | `env_upsert` invalid name; `env_active_set` missing env | Mapped to `IpcError::InvalidTarget`; surfaced as inline toast in EditEnvDialog. |

`IpcError` and `CoreError` enums are **not modified** in Plan #4. The exhaustive-match test in `ipc::error::tests::from_core_error_exhaustive` (Plan #1) needs no update.

## 9. Testing strategy

### 9.1 Core unit tests (`#[cfg(test)]`)

| Module | Tests |
|---|---|
| `vars::resolve_string` | properties from §4.2 |
| `vars::resolve_template_with_diagnostics` | `diagnostics_collects_all_unresolved`, `diagnostics_returns_partial_resolved`, `diagnostics_cycle_priority`, `no_vars_returns_input_unchanged` |
| `vars` helpers | regex compiles; literal `{{ }}` without matching name pattern is left alone |
| `env::InMemoryEnvironmentStore` | `with_default_creates_default_env`, `upsert_replaces_existing`, `upsert_validates_name`, `list_returns_all`, `get_returns_clone`, `delete_removes` |
| `env` concurrency | spawn 10 tokio tasks doing concurrent upsert+list — no panics, last-writer-wins |

### 9.2 Integration tests (`crates/handshaker-core/tests/`)

| File | Purpose |
|---|---|
| `vars_end_to_end.rs` | Build a `VariableSet` from a constructed `Environment`, resolve a multi-line template containing chained vars + literal `{{` braces — verify output. |

The IPC layer is tested implicitly through the manual UI smoke. `tauri::test` integration is out of scope (no precedent in Plans #1–#3; introducing it is a separate effort).

### 9.3 Frontend tests

No Vitest in the project yet (Plan #3 UI Polish §7.1). We continue manual smoke as the verification mechanism.

### 9.4 Manual UI smoke

After implementation:

1. Start `cargo tauri dev`.
2. **Header pill present.** `Default ▾` is visible right-aligned in the header.
3. **Open dialog.** Click pill → dialog opens, title `Edit variables — Default`, empty table with one empty-row.
4. **Add variables.** Type `uid` / `abc-123` in empty-row → row materializes, new empty-row appears below. Add a second `env_label` / `production`. Save → dialog closes.
5. **Reopen dialog → variables persist** (in-memory across Save/Reopen).
6. **Connect & pick a method** (against `127.0.0.1:5002`).
7. **Body editor uses `json-with-vars`.** Type `{"user_id":"{{uid}}"}` → `{{uid}}` is rendered in warm yellow bold.
8. **Live preview.** Below editor: `→ resolves: {"user_id":"abc-123"}` appears within ~300 ms of typing.
9. **Unresolved variable.** Edit body to `{"x":"{{missing}}"}` → preview turns red: `⚠ Unresolved: missing`.
10. **Send with unresolved.** Click Send → inline toast "Unresolved variables: missing", no request sent (response panel unchanged).
11. **Cycle.** Open dialog, add `a = {{b}}`, `b = {{a}}`. Body `{{a}}`. Preview: `⚠ Cycle: a → b → a`. Send → toast "Variable cycle: a → b → a".
12. **Happy path.** Fix body to `{"user_id":"{{uid}}"}`. Send → server receives resolved JSON, OK response.
13. **`{{ literal }}` left alone.** Body `"{{1bad}}"` (digit-leading) → no resolve, no error; `{{1bad}}` is plain text (no highlight, no preview line because regex didn't match — preview empty).
14. **Regression sweep.** Ctrl+Enter still Sends; Tabs `Body | Trailers (n)` still work; ConnectPanel address still resolves connection.

### 9.5 `cargo test --workspace`

Should grow from current `50 passed + 1 ignored` to `~70 passed + 1 ignored` (depending on test count growth from §9.1 + §9.2). The `#[ignore]` test (`invoke_live.rs`) is untouched.

## 10. Open risks and mitigation

| # | Risk | Mitigation |
|---|---|---|
| R1 | Monaco custom language without diagnostics confuses users — invalid JSON no longer flagged with red squiggles. | Pre-Send `JSON.parse(body)` already shows a parse error in toast (Plan #3). Plan #4b will add proper diagnostics. Documented in §7.2. |
| R2 | The minimal copied JSON Monarch grammar misses an edge case (e.g. unicode escape) and breaks highlighting on real-world request bodies. | Monarch rules degrade gracefully — unmatched text is rendered untokenized (default theme color). Fix iteratively in errata if found during §9.4. |
| R3 | `vars_resolve` debounce vs `setOutcome` race — user spams Enter, debounce fires after Send completed. | Debounced preview state is local to `ResolvesPreview`; it doesn't trigger Send. Send always calls `vars_resolve` synchronously fresh. No race. |
| R4 | Cycle detection complexity creeps when chain length is long (many env vars chained). | `MAX_PASSES = 4` caps work; DFS is O(V+E) over the env+collection map (always small in practice). No risk for MVP scale. |
| R5 | tauri-specta bindings regeneration drift — adding 5 commands + 1 event. | Standard `cargo run -p handshaker --bin export-bindings` step in implementation plan; `pnpm lint` will catch type drift in `client.ts`. |
| R6 | `EnvPill` chevron suggests a switcher that doesn't exist — users click expecting a list of envs and see a dialog. | Acceptable for MVP — only one Default env exists, and clicking → "edit variables" is the only sensible action. We'll revisit affordance when multi-env arrives. Could mitigate via different icon (e.g. `Pencil`) but `▾` matches master §8.1 line 598. |

## 11. Implementation order (input to writing-plans)

Roughly TDD-friendly order; `writing-plans` will refine into discrete tasks with TDD breakdown.

1. **`vars/` module** + unit tests (no deps on env). Includes `MAX_PASSES`, regex, `resolve_string`, `resolve_template_with_diagnostics`, cycle-chain construction.
2. **`env/` module** + unit tests. `Environment`, `EnvironmentStore` trait, `InMemoryEnvironmentStore`, `with_default()`, concurrency test.
3. **`lib.rs` pub re-exports** for `vars` and `env`.
4. **Tauri state** extension in `state.rs` — `env_store: Arc<dyn EnvironmentStore>`, `active_env: RwLock<String>`. Bootstrap seeds Default.
5. **IPC types** `EnvironmentIpc`, `ResolutionReportIpc` + `From` impls.
6. **IPC commands** `env_list`, `env_active_get`, `env_active_set`, `env_upsert`, `vars_resolve`.
7. **Command registration** in `lib.rs` (`collect_commands!`, `invoke_handler`).
8. **Regenerate bindings** via `cargo run -p handshaker --bin export-bindings`.
9. **Frontend IPC wrappers** in `ipc/client.ts`.
10. **Monaco custom language** registration in `lib/monaco.ts`; switch `BodyEditor` to `json-with-vars` and `handshaker-dark` theme.
11. **`EnvPill` + `EditEnvDialog` + `VariablesTable`** components; add `<EnvPill />` to header in `App.tsx`. shadcn add `dialog` if absent.
12. **`ResolvesPreview` component** + integrate into `InvokePanel`.
13. **Send-flow modification** in `InvokePanel.handleSend` — call `vars_resolve` first.
14. **Manual UI smoke** (`§9.4`); fix issues; iterate.
15. **Errata file** if any deviation surfaces during implementation (per Plan #3 UI Polish precedent).

## 12. Sources verified before submission

| Source | URL | Used for |
|---|---|---|
| Master spec §5.2 | local | env+var model, resolver semantics |
| Master spec §6.2, §6.3 | local | IPC commands and events |
| Master spec §8.1, §8.8 | local | header pill placement, variable color |
| Plan #1 `CoreError` | `crates/handshaker-core/src/error.rs` | confirms `UnresolvedVariable`, `VariableCycle`, `InvalidTarget` already exist |
| Plan #3 design `invoke_unary` | `2026-05-27-plan-03-dynamic-invoke-design.md` | invoke signature unchanged in #4 |
| Plan #3 UI Polish §1 | `2026-05-27-plan-03-ui-polish-design.md` | explicit deferral list confirming #4 scope |
| Monaco Monarch | <https://microsoft.github.io/monaco-editor/monarch.html> | `setMonarchTokensProvider` + token IDs |
| Monaco `defineTheme` | <https://microsoft.github.io/monaco-editor/typedoc/functions/editor.defineTheme.html> | theme rule `{ token, foreground, fontStyle }` |
| Extend Monaco language pattern | <https://github.com/Pranomvignesh/extend-monaco-language-tokenizer> | alternative considered & rejected (see §7.3) |
| Memory rule `feedback_verify_technical_claims` | local | requires source citations |
| Memory rule `feedback_ui_transparent_mechanics` | local | informs §6.1 chevron justification |
| Memory rule `preference_subagent_driven_default` | local | execution mode after writing-plans |
