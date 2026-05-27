# Plan #4 — Env + Vars Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire end-to-end `{{var}}` substitution into Handshaker — resolver in `handshaker-core`, `Environment` store with a single bootstrap `Default` env, IPC commands for env/vars, Monaco `json-with-vars` syntax highlighting, `EnvPill` in the header, `EditEnvDialog` for editing the Default env, debounced `ResolvesPreview` under the body editor, and a Send flow that resolves before invoking.

**Architecture:** Three cohesive layers per [spec §2](../specs/2026-05-27-plan-04-env-vars-design.md#2-architecture--three-layers). Core gets `vars/` and `env/` modules with strict + diagnostic resolver entry-points. Tauri state seeds a Default env at startup; 5 IPC commands (`env_list`, `env_active_get`, `env_active_set`, `env_upsert`, `vars_resolve`). Frontend registers a custom Monaco language, adds env-pill + dialog in the header, and routes Send through `vars_resolve` before `grpc_invoke_unary`.

**Tech Stack:** Rust (workspace edition, `tokio`, `regex`, `std::sync::LazyLock`), Tauri 2, `tauri-specta` v2, React 18 + Vite + TypeScript, Monaco editor (`@monaco-editor/react` 4.7, `monaco-editor` 0.55), shadcn/ui (`Dialog` to be added), Tailwind v4. Error handling via existing `onError(message)` callback pattern from Plan #3 (no `sonner` dependency).

**Spec:** [`docs/superpowers/specs/2026-05-27-plan-04-env-vars-design.md`](../specs/2026-05-27-plan-04-env-vars-design.md) — authoritative on conflicts. Implementation tasks below realise §11 with TDD-friendly granularity.

---

## File map (decomposition)

**Core (`crates/handshaker-core/`):**
- `Cargo.toml` — add `regex` workspace dependency.
- `src/lib.rs` — re-export new modules `vars`, `env`.
- `src/vars/mod.rs` — `VariableSet`, `ResolutionReport`, `MAX_PASSES`, `resolve_string`, `resolve_template_with_diagnostics`, regex constant. Plus `#[cfg(test)] mod tests`.
- `src/env/mod.rs` — `Environment` value type, `EnvironmentStore` trait.
- `src/env/in_memory.rs` — `InMemoryEnvironmentStore` with `with_default()` constructor. Plus `#[cfg(test)] mod tests`.

**Workspace `Cargo.toml`** — declare `regex = "1"` in `[workspace.dependencies]` if absent.

**Tauri shell (`src-tauri/`):**
- `src/state.rs` — extend `AppState` with `env_store` + `active_env`.
- `src/ipc/env.rs` (NEW) — `EnvironmentIpc` + `From` impls.
- `src/ipc/vars.rs` (NEW) — `ResolutionReportIpc` + `From` impl.
- `src/ipc/mod.rs` — `pub mod env; pub mod vars;`.
- `src/commands/env.rs` (NEW) — 4 commands.
- `src/commands/vars.rs` (NEW) — 1 command.
- `src/commands/mod.rs` — `pub mod env; pub mod vars;`.
- `src/lib.rs` — register all 5 new commands in `collect_commands!` + invoke_handler; remove stale Plan #5 comment in state.rs.

**Frontend (`src/`):**
- `src/ipc/bindings.ts` — regenerated via `cargo run -p handshaker --bin export-bindings`.
- `src/ipc/client.ts` — typed wrappers for `env_*` and `vars_resolve`.
- `src/lib/monaco.ts` — register `json-with-vars` language + `handshaker-dark` theme.
- `src/features/invoke/BodyEditor.tsx` — switch to `json-with-vars` + `handshaker-dark`.
- `src/components/ui/dialog.tsx` (NEW if absent) — shadcn add.
- `src/features/envs/` (NEW directory):
  - `VariablesTable.tsx` — key/value table with empty-row and ✕.
  - `EditEnvDialog.tsx` — shadcn Dialog wrapping VariablesTable + save flow.
  - `EnvPill.tsx` — header ghost-button opening EditEnvDialog.
- `src/features/invoke/ResolvesPreview.tsx` (NEW) — debounced single-line preview.
- `src/features/invoke/InvokePanel.tsx` — render ResolvesPreview + modify handleSend to call `vars_resolve` first.
- `src/App.tsx` — render `<EnvPill />` in header, load active env on mount.

---

## Task 0: Read the spec

**Files:** none (read-only).

- [ ] **Step 1: Read the design spec**

Read `docs/superpowers/specs/2026-05-27-plan-04-env-vars-design.md` in full. The plan below assumes you know §3 (data types), §4 (resolver semantics), §5 (IPC contract), and §6 (UI surface). When in doubt, the spec wins.

- [ ] **Step 2: Read prior errata**

Read `docs/superpowers/errata/2026-05-27-plan-03-ui-polish.md` — Plan #4 inherits all 6 deviations (Postman-style tabs, Monaco lazy bundle, Send hotkey on capture phase, etc.).

---

## Task 1: Add `regex` dependency + `vars/` module skeleton

**Files:**
- Modify: `Cargo.toml` (workspace root)
- Modify: `crates/handshaker-core/Cargo.toml`
- Create: `crates/handshaker-core/src/vars/mod.rs`
- Modify: `crates/handshaker-core/src/lib.rs`

- [ ] **Step 1: Inspect the workspace `Cargo.toml`**

Run: `cat Cargo.toml | grep -A2 workspace.dependencies` (or open it).
If `regex = "..."` is **not** listed under `[workspace.dependencies]`, add it. If it **is** already listed, skip the workspace edit.

- [ ] **Step 2: Add `regex` to workspace dependencies (if missing)**

In `Cargo.toml` (workspace root), inside `[workspace.dependencies]`, add:

```toml
regex = "1"
```

- [ ] **Step 3: Add `regex` to handshaker-core**

In `crates/handshaker-core/Cargo.toml`, inside `[dependencies]`, add:

```toml
regex.workspace = true
```

- [ ] **Step 4: Create `vars/mod.rs` skeleton**

Create `crates/handshaker-core/src/vars/mod.rs`:

```rust
//! Variable substitution for `{{var}}` placeholders.
//!
//! Two entry-points:
//! - [`resolve_string`] — strict; returns `Err(CoreError::UnresolvedVariable | VariableCycle)`.
//!   Used by anything that needs a fully-resolved string (e.g. the invoke path).
//! - [`resolve_template_with_diagnostics`] — non-failing; always returns a `ResolutionReport`
//!   with the best-effort substitution and lists of unresolved names / cycle chain.
//!   Used by UI for live preview.
//!
//! See `docs/superpowers/specs/2026-05-27-plan-04-env-vars-design.md` §4 for full semantics.

use std::collections::HashMap;
use std::sync::LazyLock;

use regex::Regex;

use crate::error::CoreError;

/// Cap on substitution passes; beyond this we assume a cycle (see §4).
pub const MAX_PASSES: usize = 4;

/// Matches `{{name}}` where `name` starts with a letter or underscore and contains
/// letters / digits / underscore / hyphen. Per master spec §5.2 line 223.
static VAR_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"\{\{([a-zA-Z_][a-zA-Z0-9_-]*)\}\}")
        .expect("VAR_RE is a known-good regex")
});

/// Borrowed view over the env- and collection-scope variable maps for one resolve call.
/// Lookup priority is `env > collection`.
pub struct VariableSet<'a> {
    pub env: &'a HashMap<String, String>,
    pub collection: &'a HashMap<String, String>,
}

/// Outcome of [`resolve_template_with_diagnostics`]. Never an error type; missing vars
/// and cycles are *data*, not control flow.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ResolutionReport {
    /// Best-effort substitution result. Unresolved `{{var}}` placeholders are left as-is.
    pub resolved: String,
    /// Variable names referenced but absent from both `env` and `collection`.
    /// Deduplicated, ordered by first appearance in the final string.
    /// Empty when `cycle_chain` is `Some` (those names are part of the cycle, not missing).
    pub unresolved_vars: Vec<String>,
    /// When substitution did not converge within `MAX_PASSES`, the detected cycle chain
    /// formatted like `["a", "b", "a"]` (start node repeated at end).
    pub cycle_chain: Option<Vec<String>>,
}

#[inline]
fn lookup<'a>(name: &str, vars: &VariableSet<'a>) -> Option<&'a String> {
    vars.env.get(name).or_else(|| vars.collection.get(name))
}
```

- [ ] **Step 5: Re-export from `lib.rs`**

In `crates/handshaker-core/src/lib.rs`, add (alphabetically with existing `pub mod` lines):

```rust
pub mod env;
pub mod vars;
```

(`env` doesn't exist yet — that's intentional; the next compile error confirms Task 2 is the natural next step. If you compile now between adding the modules, comment `pub mod env;` out temporarily and re-add in Task 5.)

- [ ] **Step 6: Verify compile (without env module)**

Run: `cargo check -p handshaker-core --lib`
Expected: Either "couldn't find module `env`" (if you left both `pub mod`s in) or clean if you commented `env` out. The `vars` module on its own must compile.

- [ ] **Step 7: Commit**

```bash
git add Cargo.toml crates/handshaker-core/Cargo.toml crates/handshaker-core/src/vars/mod.rs crates/handshaker-core/src/lib.rs
git commit -m "feat(core/vars): scaffold vars module with VariableSet + ResolutionReport"
```

---

## Task 2: `resolve_template_with_diagnostics` — single-pass + unresolved

**Files:**
- Modify: `crates/handshaker-core/src/vars/mod.rs`

- [ ] **Step 1: Add failing tests**

Append to `crates/handshaker-core/src/vars/mod.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    fn vs<'a>(env: &'a HashMap<String, String>, coll: &'a HashMap<String, String>) -> VariableSet<'a> {
        VariableSet { env, collection: coll }
    }

    fn map(pairs: &[(&str, &str)]) -> HashMap<String, String> {
        pairs.iter().map(|(k, v)| ((*k).to_string(), (*v).to_string())).collect()
    }

    #[test]
    fn no_vars_passthrough() {
        let env = map(&[]);
        let coll = map(&[]);
        let r = resolve_template_with_diagnostics("hello world", &vs(&env, &coll));
        assert_eq!(r.resolved, "hello world");
        assert!(r.unresolved_vars.is_empty());
        assert!(r.cycle_chain.is_none());
    }

    #[test]
    fn single_pass_env_only() {
        let env = map(&[("x", "1")]);
        let coll = map(&[]);
        let r = resolve_template_with_diagnostics("{{x}}", &vs(&env, &coll));
        assert_eq!(r.resolved, "1");
        assert!(r.unresolved_vars.is_empty());
    }

    #[test]
    fn single_pass_collection_only() {
        let env = map(&[]);
        let coll = map(&[("x", "c")]);
        let r = resolve_template_with_diagnostics("{{x}}", &vs(&env, &coll));
        assert_eq!(r.resolved, "c");
    }

    #[test]
    fn env_overrides_collection() {
        let env = map(&[("x", "e")]);
        let coll = map(&[("x", "c")]);
        let r = resolve_template_with_diagnostics("{{x}}", &vs(&env, &coll));
        assert_eq!(r.resolved, "e");
    }

    #[test]
    fn invalid_name_left_alone() {
        // Names starting with a digit don't match the regex — should pass through literally.
        let env = map(&[]);
        let coll = map(&[]);
        let r = resolve_template_with_diagnostics("{{1bad}}", &vs(&env, &coll));
        assert_eq!(r.resolved, "{{1bad}}");
        assert!(r.unresolved_vars.is_empty());
    }

    #[test]
    fn unresolved_single_collected() {
        let env = map(&[]);
        let coll = map(&[]);
        let r = resolve_template_with_diagnostics("{{missing}}", &vs(&env, &coll));
        assert_eq!(r.resolved, "{{missing}}");
        assert_eq!(r.unresolved_vars, vec!["missing".to_string()]);
        assert!(r.cycle_chain.is_none());
    }

    #[test]
    fn diagnostics_collects_all_unresolved() {
        let env = map(&[]);
        let coll = map(&[]);
        let r = resolve_template_with_diagnostics("{{a}} {{b}} {{a}}", &vs(&env, &coll));
        // Dedup, order-preserving:
        assert_eq!(r.unresolved_vars, vec!["a".to_string(), "b".to_string()]);
    }
}
```

- [ ] **Step 2: Run tests — they must fail to compile (no impl yet)**

Run: `cargo test -p handshaker-core vars::tests --no-run`
Expected: compile error "cannot find function `resolve_template_with_diagnostics` in this scope".

- [ ] **Step 3: Implement single-pass `resolve_template_with_diagnostics`**

Append to `crates/handshaker-core/src/vars/mod.rs` (above `#[cfg(test)] mod tests`):

```rust
/// Non-failing resolve — collects diagnostics and returns best-effort partial result.
/// Used for UI preview.
pub fn resolve_template_with_diagnostics(
    template: &str,
    vars: &VariableSet<'_>,
) -> ResolutionReport {
    let mut current = template.to_string();
    let mut converged = false;

    for _ in 0..MAX_PASSES {
        let (next, changed) = substitute_once(&current, vars);
        current = next;
        if !changed {
            converged = true;
            break;
        }
    }

    let unresolved_vars = collect_unresolved(&current);

    let cycle_chain = if !converged && !unresolved_vars.is_empty() {
        None  // Filled in by Task 4 — cycle detection.
    } else {
        None
    };

    let final_unresolved = if cycle_chain.is_some() {
        Vec::new()
    } else {
        unresolved_vars
    };

    ResolutionReport {
        resolved: current,
        unresolved_vars: final_unresolved,
        cycle_chain,
    }
}

/// One substitution pass. Returns the new string and a flag indicating whether any
/// substitution happened (used by the caller to decide whether to continue iterating).
fn substitute_once(input: &str, vars: &VariableSet<'_>) -> (String, bool) {
    let mut out = String::with_capacity(input.len());
    let mut last_end = 0;
    let mut changed = false;
    for caps in VAR_RE.captures_iter(input) {
        let whole = caps.get(0).unwrap();
        let name = caps.get(1).unwrap().as_str();
        out.push_str(&input[last_end..whole.start()]);
        match lookup(name, vars) {
            Some(val) => {
                out.push_str(val);
                changed = true;
            }
            None => out.push_str(whole.as_str()),
        }
        last_end = whole.end();
    }
    out.push_str(&input[last_end..]);
    (out, changed)
}

/// Collect remaining `{{name}}` matches, deduplicated, in first-appearance order.
fn collect_unresolved(s: &str) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for caps in VAR_RE.captures_iter(s) {
        let name = caps.get(1).unwrap().as_str().to_string();
        if !out.contains(&name) {
            out.push(name);
        }
    }
    out
}
```

- [ ] **Step 4: Run tests — must pass**

Run: `cargo test -p handshaker-core vars::tests`
Expected: 7 passed.

- [ ] **Step 5: Commit**

```bash
git add crates/handshaker-core/src/vars/mod.rs
git commit -m "feat(core/vars): single-pass substitution + unresolved diagnostics"
```

---

## Task 3: Multi-pass chained substitution

**Files:**
- Modify: `crates/handshaker-core/src/vars/mod.rs`

- [ ] **Step 1: Add failing tests for chained vars**

Inside the existing `#[cfg(test)] mod tests` in `crates/handshaker-core/src/vars/mod.rs`, add:

```rust
    #[test]
    fn chained_two_pass() {
        // {{a}} → {{b}} → "2"
        let env = map(&[("a", "{{b}}"), ("b", "2")]);
        let coll = map(&[]);
        let r = resolve_template_with_diagnostics("{{a}}", &vs(&env, &coll));
        assert_eq!(r.resolved, "2");
        assert!(r.unresolved_vars.is_empty());
        assert!(r.cycle_chain.is_none());
    }

    #[test]
    fn chain_three_hops() {
        // {{a}} → {{b}} → {{c}} → "3" (3 hops, within MAX_PASSES=4)
        let env = map(&[("a", "{{b}}"), ("b", "{{c}}"), ("c", "3")]);
        let coll = map(&[]);
        let r = resolve_template_with_diagnostics("{{a}}", &vs(&env, &coll));
        assert_eq!(r.resolved, "3");
    }

    #[test]
    fn chain_mixed_with_literal() {
        let env = map(&[("uri", "https://api.{{env}}.example.com"), ("env", "prod")]);
        let coll = map(&[]);
        let r = resolve_template_with_diagnostics(
            r#"{"url": "{{uri}}/v1/users"}"#,
            &vs(&env, &coll),
        );
        assert_eq!(r.resolved, r#"{"url": "https://api.prod.example.com/v1/users"}"#);
    }
```

- [ ] **Step 2: Run tests — they must pass already**

Run: `cargo test -p handshaker-core vars::tests`
Expected: 10 passed. (Multi-pass is implicit in the `for _ in 0..MAX_PASSES` loop from Task 2; these tests verify the loop actually iterates correctly.)

If `chained_two_pass` fails with `resolved == "{{b}}"`, you forgot to put the loop in `resolve_template_with_diagnostics` — re-check Task 2 Step 3.

- [ ] **Step 3: Commit (verification-only commit)**

```bash
git add crates/handshaker-core/src/vars/mod.rs
git commit -m "test(core/vars): verify multi-pass chained substitution"
```

---

## Task 4: Cycle detection + chain construction

**Files:**
- Modify: `crates/handshaker-core/src/vars/mod.rs`

- [ ] **Step 1: Add failing cycle tests**

Inside `#[cfg(test)] mod tests`, add:

```rust
    #[test]
    fn cycle_two_node() {
        // {{a}} → {{b}} → {{a}} (cycle)
        let env = map(&[("a", "{{b}}"), ("b", "{{a}}")]);
        let coll = map(&[]);
        let r = resolve_template_with_diagnostics("{{a}}", &vs(&env, &coll));
        assert!(r.cycle_chain.is_some(), "expected cycle, got {:?}", r);
        let chain = r.cycle_chain.unwrap();
        // Chain starts and ends with the same name (back-edge form).
        assert_eq!(chain.first(), chain.last());
        // Contains both 'a' and 'b'.
        assert!(chain.contains(&"a".to_string()));
        assert!(chain.contains(&"b".to_string()));
        // When cycle is reported, unresolved_vars is cleared.
        assert!(r.unresolved_vars.is_empty());
    }

    #[test]
    fn cycle_self() {
        // {{a}} → {{a}} (self-loop)
        let env = map(&[("a", "{{a}}")]);
        let coll = map(&[]);
        let r = resolve_template_with_diagnostics("{{a}}", &vs(&env, &coll));
        let chain = r.cycle_chain.expect("expected cycle");
        assert_eq!(chain, vec!["a".to_string(), "a".to_string()]);
    }

    #[test]
    fn cycle_three_node() {
        // a → b → c → a
        let env = map(&[("a", "{{b}}"), ("b", "{{c}}"), ("c", "{{a}}")]);
        let coll = map(&[]);
        let r = resolve_template_with_diagnostics("{{a}}", &vs(&env, &coll));
        let chain = r.cycle_chain.expect("expected cycle");
        // Should include all three names (a, b, c) plus the closing repeat.
        assert!(chain.len() >= 4, "chain too short: {chain:?}");
        assert_eq!(chain.first(), chain.last());
    }
```

- [ ] **Step 2: Run tests — must fail**

Run: `cargo test -p handshaker-core vars::tests::cycle_two_node`
Expected: FAIL with `expected cycle, got ResolutionReport { ..., cycle_chain: None }` — `cycle_chain` is currently hardcoded to `None` in `resolve_template_with_diagnostics`.

- [ ] **Step 3: Implement cycle detection**

In `crates/handshaker-core/src/vars/mod.rs`, replace the cycle stub in `resolve_template_with_diagnostics`:

```rust
    let cycle_chain = if !converged && !unresolved_vars.is_empty() {
        detect_cycle(&unresolved_vars, vars)
    } else {
        None
    };
```

And add these helpers above `substitute_once`:

```rust
/// Pick the lexicographically smallest seed name and DFS from it through the
/// substitution graph (env ∪ collection definitions). Return the first cycle found.
/// `None` if no cycle is reachable from any seed (shouldn't happen if MAX_PASSES
/// was exhausted with unresolved names remaining, but we handle it defensively).
fn detect_cycle(seeds: &[String], vars: &VariableSet<'_>) -> Option<Vec<String>> {
    let mut sorted: Vec<&String> = seeds.iter().collect();
    sorted.sort();
    for seed in sorted {
        let mut stack: Vec<String> = Vec::new();
        if let Some(chain) = dfs(seed, vars, &mut stack) {
            return Some(chain);
        }
    }
    None
}

fn dfs(name: &str, vars: &VariableSet<'_>, stack: &mut Vec<String>) -> Option<Vec<String>> {
    if let Some(start) = stack.iter().position(|n| n == name) {
        // Back-edge: cycle from `start..` in stack, repeated at end.
        let mut chain: Vec<String> = stack[start..].to_vec();
        chain.push(name.to_string());
        return Some(chain);
    }
    let value = lookup(name, vars)?;
    stack.push(name.to_string());
    for caps in VAR_RE.captures_iter(value) {
        let next = caps.get(1).unwrap().as_str();
        if let Some(chain) = dfs(next, vars, stack) {
            return Some(chain);
        }
    }
    stack.pop();
    None
}
```

- [ ] **Step 4: Run cycle tests — must pass**

Run: `cargo test -p handshaker-core vars::tests`
Expected: 13 passed.

- [ ] **Step 5: Commit**

```bash
git add crates/handshaker-core/src/vars/mod.rs
git commit -m "feat(core/vars): cycle detection with chain construction"
```

---

## Task 5: Strict `resolve_string` wrapper + final test sweep

**Files:**
- Modify: `crates/handshaker-core/src/vars/mod.rs`

- [ ] **Step 1: Add failing tests for `resolve_string`**

Inside `#[cfg(test)] mod tests`:

```rust
    #[test]
    fn resolve_string_ok_when_resolved() {
        let env = map(&[("x", "1")]);
        let coll = map(&[]);
        let s = resolve_string("{{x}}", &vs(&env, &coll)).unwrap();
        assert_eq!(s, "1");
    }

    #[test]
    fn resolve_string_err_unresolved() {
        let env = map(&[]);
        let coll = map(&[]);
        let err = resolve_string("{{missing}}", &vs(&env, &coll)).unwrap_err();
        match err {
            CoreError::UnresolvedVariable { name } => assert_eq!(name, "missing"),
            other => panic!("expected UnresolvedVariable, got {other:?}"),
        }
    }

    #[test]
    fn resolve_string_err_cycle() {
        let env = map(&[("a", "{{b}}"), ("b", "{{a}}")]);
        let coll = map(&[]);
        let err = resolve_string("{{a}}", &vs(&env, &coll)).unwrap_err();
        match err {
            CoreError::VariableCycle { chain } => {
                assert_eq!(chain.first(), chain.last());
                assert!(chain.contains(&"a".to_string()));
            }
            other => panic!("expected VariableCycle, got {other:?}"),
        }
    }

    #[test]
    fn resolve_string_err_unresolved_picks_first() {
        let env = map(&[]);
        let coll = map(&[]);
        let err = resolve_string("{{first}} {{second}}", &vs(&env, &coll)).unwrap_err();
        match err {
            CoreError::UnresolvedVariable { name } => assert_eq!(name, "first"),
            other => panic!("expected UnresolvedVariable, got {other:?}"),
        }
    }
```

- [ ] **Step 2: Run — must fail to compile**

Run: `cargo test -p handshaker-core vars::tests::resolve_string_ok_when_resolved --no-run`
Expected: "cannot find function `resolve_string` in this scope".

- [ ] **Step 3: Implement `resolve_string`**

Append to `crates/handshaker-core/src/vars/mod.rs`, above `substitute_once`:

```rust
/// Strict resolve — fails on the first unresolved variable or any detected cycle.
/// Use this in the invoke path or anywhere a fully-resolved string is required.
pub fn resolve_string(template: &str, vars: &VariableSet<'_>) -> Result<String, CoreError> {
    let report = resolve_template_with_diagnostics(template, vars);
    if let Some(chain) = report.cycle_chain {
        return Err(CoreError::VariableCycle { chain });
    }
    if let Some(name) = report.unresolved_vars.into_iter().next() {
        return Err(CoreError::UnresolvedVariable { name });
    }
    Ok(report.resolved)
}
```

- [ ] **Step 4: Run all vars tests — must pass**

Run: `cargo test -p handshaker-core vars`
Expected: 17 passed.

- [ ] **Step 5: Run full crate tests to verify no regression**

Run: `cargo test -p handshaker-core --lib`
Expected: all prior tests still pass + 17 new vars tests.

- [ ] **Step 6: Create integration test `tests/vars_end_to_end.rs`**

Per spec §9.2 — verify the resolver via the public API, not internals.

Create `crates/handshaker-core/tests/vars_end_to_end.rs`:

```rust
//! End-to-end integration test for the `vars` public API.
//! Verifies multi-line templates with chained vars + literal `{{` braces survive intact.

use std::collections::HashMap;

use handshaker_core::vars::{resolve_string, VariableSet};

fn map(pairs: &[(&str, &str)]) -> HashMap<String, String> {
    pairs.iter().map(|(k, v)| ((*k).to_string(), (*v).to_string())).collect()
}

#[test]
fn multiline_template_with_chained_vars_resolves() {
    let env = map(&[
        ("uri-root", "https://api.{{stage}}.example.com"),
        ("stage", "prod"),
        ("uid", "abc-123"),
    ]);
    let coll = map(&[]);
    let vars = VariableSet { env: &env, collection: &coll };

    let template = "\
        POST {{uri-root}}/v1/users\n\
        Authorization: Bearer ...\n\
        \n\
        { \"user_id\": \"{{uid}}\", \"note\": \"literal {{{{ stays }}}}\" }\n\
    ";
    let resolved = resolve_string(template, &vars).expect("resolve");
    assert!(resolved.contains("https://api.prod.example.com/v1/users"));
    assert!(resolved.contains(r#""user_id": "abc-123""#));
    // Literal {{ braces — escaped via doubled braces in template — survive untouched
    // because the resolver only matches valid identifier names inside {{...}}.
    // The substring "{{ stays }}" (with a space) doesn't match the regex pattern.
    assert!(resolved.contains("{{ stays }}"), "expected literal `{{{{ stays }}}}` in: {resolved}");
}
```

- [ ] **Step 7: Run integration test**

Run: `cargo test -p handshaker-core --test vars_end_to_end`
Expected: 1 passed.

- [ ] **Step 8: Commit**

```bash
git add crates/handshaker-core/src/vars/mod.rs crates/handshaker-core/tests/vars_end_to_end.rs
git commit -m "feat(core/vars): strict resolve_string + integration test"
```

---

## Task 6: `env/` module — `Environment` + `EnvironmentStore` trait

**Files:**
- Create: `crates/handshaker-core/src/env/mod.rs`
- Modify: `crates/handshaker-core/src/lib.rs` (uncomment `pub mod env;` if you commented it)

- [ ] **Step 1: Create `env/mod.rs`**

Create `crates/handshaker-core/src/env/mod.rs`:

```rust
//! Environment state — named variable sets.
//!
//! Storage abstraction lives in this module; the in-memory implementation lives
//! in [`in_memory`]. Active-env tracking is *not* a core concept — it's a Tauri
//! session concept handled in `src-tauri/src/state.rs`.

use std::collections::HashMap;

use crate::error::CoreError;

pub mod in_memory;

/// Named variable set.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Environment {
    /// Unique identifier; must match `^[a-zA-Z_][a-zA-Z0-9_-]*$`.
    pub name: String,
    pub variables: HashMap<String, String>,
}

/// Storage abstraction for environments. Implementations: [`in_memory::InMemoryEnvironmentStore`].
pub trait EnvironmentStore: Send + Sync {
    fn list(&self) -> Vec<Environment>;
    fn get(&self, name: &str) -> Option<Environment>;
    fn upsert(&self, env: Environment) -> Result<(), CoreError>;
    fn delete(&self, name: &str) -> Result<(), CoreError>;
}

/// Validate an env name per master spec §5.2.
pub(crate) fn validate_env_name(name: &str) -> Result<(), CoreError> {
    use std::sync::LazyLock;
    use regex::Regex;
    static NAME_RE: LazyLock<Regex> =
        LazyLock::new(|| Regex::new(r"^[a-zA-Z_][a-zA-Z0-9_-]*$").unwrap());
    if !NAME_RE.is_match(name) {
        return Err(CoreError::InvalidTarget(format!("invalid env name: `{name}`")));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn name_validation_accepts_typical() {
        assert!(validate_env_name("Default").is_ok());
        assert!(validate_env_name("prod_eu").is_ok());
        assert!(validate_env_name("_internal").is_ok());
        assert!(validate_env_name("env-1").is_ok());
    }

    #[test]
    fn name_validation_rejects_bad() {
        assert!(validate_env_name("").is_err());
        assert!(validate_env_name("1bad").is_err());
        assert!(validate_env_name("with space").is_err());
        assert!(validate_env_name("with.dot").is_err());
    }
}
```

- [ ] **Step 2: Ensure `pub mod env;` is in `lib.rs`**

If you commented it out in Task 1 Step 5, uncomment it now. `lib.rs` should have both:

```rust
pub mod env;
pub mod vars;
```

- [ ] **Step 3: Verify compile + run tests**

Run: `cargo test -p handshaker-core env::tests`
Expected: 2 passed. (The `in_memory` submodule referenced via `pub mod in_memory;` does not exist yet — this WILL fail compile with "file not found".)

If compile fails, create an empty `crates/handshaker-core/src/env/in_memory.rs` with a single line `//! Placeholder for Task 7.` and re-run.

- [ ] **Step 4: Commit**

```bash
git add crates/handshaker-core/src/env/mod.rs crates/handshaker-core/src/env/in_memory.rs crates/handshaker-core/src/lib.rs
git commit -m "feat(core/env): Environment + EnvironmentStore trait + name validation"
```

---

## Task 7: `InMemoryEnvironmentStore` + `with_default()` + concurrency test

**Files:**
- Modify: `crates/handshaker-core/src/env/in_memory.rs`

- [ ] **Step 1: Write failing tests**

Replace `crates/handshaker-core/src/env/in_memory.rs` with:

```rust
//! In-memory implementation of [`EnvironmentStore`].

use std::collections::HashMap;
use std::sync::RwLock;

use crate::error::CoreError;

use super::{validate_env_name, Environment, EnvironmentStore};

/// Thread-safe in-memory store. Backed by `RwLock<HashMap<String, Environment>>`.
/// Critical sections are O(1) HashMap operations — using `std::sync::RwLock` from
/// async code is safe under this load.
pub struct InMemoryEnvironmentStore {
    inner: RwLock<HashMap<String, Environment>>,
}

impl InMemoryEnvironmentStore {
    pub fn new() -> Self {
        Self { inner: RwLock::new(HashMap::new()) }
    }

    /// Bootstrap with a single empty `"Default"` env. Used by Tauri startup.
    pub fn with_default() -> Self {
        let mut map = HashMap::new();
        map.insert(
            "Default".to_string(),
            Environment {
                name: "Default".to_string(),
                variables: HashMap::new(),
            },
        );
        Self { inner: RwLock::new(map) }
    }
}

impl Default for InMemoryEnvironmentStore {
    fn default() -> Self { Self::new() }
}

impl EnvironmentStore for InMemoryEnvironmentStore {
    fn list(&self) -> Vec<Environment> {
        self.inner
            .read()
            .expect("env store lock poisoned")
            .values()
            .cloned()
            .collect()
    }

    fn get(&self, name: &str) -> Option<Environment> {
        self.inner
            .read()
            .expect("env store lock poisoned")
            .get(name)
            .cloned()
    }

    fn upsert(&self, env: Environment) -> Result<(), CoreError> {
        validate_env_name(&env.name)?;
        self.inner
            .write()
            .expect("env store lock poisoned")
            .insert(env.name.clone(), env);
        Ok(())
    }

    fn delete(&self, name: &str) -> Result<(), CoreError> {
        self.inner
            .write()
            .expect("env store lock poisoned")
            .remove(name);
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;

    #[test]
    fn with_default_creates_default_env() {
        let s = InMemoryEnvironmentStore::with_default();
        let envs = s.list();
        assert_eq!(envs.len(), 1);
        assert_eq!(envs[0].name, "Default");
        assert!(envs[0].variables.is_empty());
    }

    #[test]
    fn upsert_inserts_and_replaces() {
        let s = InMemoryEnvironmentStore::new();
        let mut vars = HashMap::new();
        vars.insert("k".to_string(), "v1".to_string());
        s.upsert(Environment { name: "e1".into(), variables: vars }).unwrap();
        assert_eq!(s.get("e1").unwrap().variables.get("k"), Some(&"v1".to_string()));

        // Replace
        let mut vars2 = HashMap::new();
        vars2.insert("k".to_string(), "v2".to_string());
        s.upsert(Environment { name: "e1".into(), variables: vars2 }).unwrap();
        assert_eq!(s.get("e1").unwrap().variables.get("k"), Some(&"v2".to_string()));
    }

    #[test]
    fn upsert_rejects_invalid_name() {
        let s = InMemoryEnvironmentStore::new();
        let err = s.upsert(Environment {
            name: "1bad".into(),
            variables: HashMap::new(),
        }).unwrap_err();
        match err {
            CoreError::InvalidTarget(msg) => assert!(msg.contains("invalid env name")),
            other => panic!("expected InvalidTarget, got {other:?}"),
        }
    }

    #[test]
    fn delete_removes_silently_idempotent() {
        let s = InMemoryEnvironmentStore::new();
        s.upsert(Environment { name: "e".into(), variables: HashMap::new() }).unwrap();
        s.delete("e").unwrap();
        assert!(s.get("e").is_none());
        // Idempotent — delete missing returns Ok.
        s.delete("e").unwrap();
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 4)]
    async fn concurrent_upsert_and_list_does_not_panic() {
        let s = Arc::new(InMemoryEnvironmentStore::new());
        let mut handles = Vec::new();
        for i in 0..10 {
            let s = s.clone();
            handles.push(tokio::spawn(async move {
                let name = format!("env_{i}");
                let mut vars = HashMap::new();
                vars.insert("k".to_string(), format!("v_{i}"));
                s.upsert(Environment { name, variables: vars }).unwrap();
                let _ = s.list();
            }));
        }
        for h in handles {
            h.await.unwrap();
        }
        assert_eq!(s.list().len(), 10);
    }
}
```

- [ ] **Step 2: Run tests**

Run: `cargo test -p handshaker-core env`
Expected: 7 passed (2 from `env::tests` in mod.rs + 5 from `env::in_memory::tests`).

- [ ] **Step 3: Commit**

```bash
git add crates/handshaker-core/src/env/in_memory.rs
git commit -m "feat(core/env): InMemoryEnvironmentStore + with_default + concurrent test"
```

---

## Task 8: Extend Tauri `AppState` with env store + active env

**Files:**
- Modify: `src-tauri/src/state.rs`

- [ ] **Step 1: Replace `state.rs`**

Replace `src-tauri/src/state.rs` with:

```rust
//! Tauri-side app state. Fields land per plans #2-#6.

use std::sync::Arc;

use handshaker_core::env::in_memory::InMemoryEnvironmentStore;
use handshaker_core::env::EnvironmentStore;
use handshaker_core::grpc::GrpcConnection;
use tokio::sync::{Mutex, RwLock};

pub struct AppState {
    /// At most one active gRPC connection per spec §4.
    pub connection: Mutex<Option<Arc<GrpcConnection>>>,
    /// Environment store, bootstrapped with a single "Default" env at startup.
    pub env_store: Arc<dyn EnvironmentStore>,
    /// Active environment name; updated by `env_active_set`. UI loads via `env_active_get`.
    pub active_env: RwLock<String>,
    // plan #6: pub collection_store: Arc<dyn CollectionStore>,
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            connection: Mutex::new(None),
            env_store: Arc::new(InMemoryEnvironmentStore::with_default()),
            active_env: RwLock::new("Default".to_string()),
        }
    }
}
```

- [ ] **Step 2: Compile check**

Run: `cargo check -p handshaker`
Expected: clean compile (the wider crate may produce warnings if commands aren't yet wired, but no errors).

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/state.rs
git commit -m "feat(tauri/state): env_store + active_env in AppState"
```

---

## Task 9: IPC type wrappers `EnvironmentIpc` + `ResolutionReportIpc`

**Files:**
- Create: `src-tauri/src/ipc/env.rs`
- Create: `src-tauri/src/ipc/vars.rs`
- Modify: `src-tauri/src/ipc/mod.rs`

- [ ] **Step 1: Inspect `ipc/mod.rs` for existing pattern**

Run: `cat src-tauri/src/ipc/mod.rs` (or open it). You should see `pub mod catalog;`, `pub mod error;`, `pub mod invoke;`. Add `pub mod env;` and `pub mod vars;` in alphabetical order.

Apply this edit to `src-tauri/src/ipc/mod.rs`:

```rust
pub mod catalog;
pub mod env;
pub mod error;
pub mod invoke;
pub mod vars;
```

- [ ] **Step 2: Create `ipc/env.rs`**

Create `src-tauri/src/ipc/env.rs`:

```rust
//! IPC wrapper for `Environment` — adds `specta::Type` and serde derives.

use std::collections::HashMap;

use handshaker_core::env::Environment;
use serde::{Deserialize, Serialize};
use specta::Type;

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct EnvironmentIpc {
    pub name: String,
    pub variables: HashMap<String, String>,
}

impl From<Environment> for EnvironmentIpc {
    fn from(e: Environment) -> Self {
        Self { name: e.name, variables: e.variables }
    }
}

impl From<EnvironmentIpc> for Environment {
    fn from(e: EnvironmentIpc) -> Self {
        Self { name: e.name, variables: e.variables }
    }
}
```

- [ ] **Step 3: Create `ipc/vars.rs`**

Create `src-tauri/src/ipc/vars.rs`:

```rust
//! IPC wrapper for `ResolutionReport`.

use handshaker_core::vars::ResolutionReport;
use serde::Serialize;
use specta::Type;

#[derive(Debug, Clone, Serialize, Type)]
pub struct ResolutionReportIpc {
    pub resolved: String,
    pub unresolved_vars: Vec<String>,
    pub cycle_chain: Option<Vec<String>>,
}

impl From<ResolutionReport> for ResolutionReportIpc {
    fn from(r: ResolutionReport) -> Self {
        Self {
            resolved: r.resolved,
            unresolved_vars: r.unresolved_vars,
            cycle_chain: r.cycle_chain,
        }
    }
}
```

- [ ] **Step 4: Compile check**

Run: `cargo check -p handshaker`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/ipc/env.rs src-tauri/src/ipc/vars.rs src-tauri/src/ipc/mod.rs
git commit -m "feat(tauri/ipc): EnvironmentIpc + ResolutionReportIpc wrappers"
```

---

## Task 10: IPC command `commands/env.rs` — 4 env commands

**Files:**
- Create: `src-tauri/src/commands/env.rs`
- Modify: `src-tauri/src/commands/mod.rs`

- [ ] **Step 1: Inspect `commands/mod.rs`**

Run: `cat src-tauri/src/commands/mod.rs`. You should see `pub mod events;`, `pub mod grpc;`, `pub mod meta;`. Add `pub mod env;` (and later `pub mod vars;` in Task 11) in alphabetical order:

```rust
pub mod env;
pub mod events;
pub mod grpc;
pub mod meta;
```

- [ ] **Step 2: Create `commands/env.rs`**

Create `src-tauri/src/commands/env.rs`:

```rust
//! Environment IPC commands. See spec §5.1.

use handshaker_core::env::Environment;
use tauri::State;

use crate::ipc::env::EnvironmentIpc;
use crate::ipc::error::IpcError;
use crate::state::AppState;

#[tauri::command]
#[specta::specta]
pub async fn env_list(state: State<'_, AppState>) -> Result<Vec<EnvironmentIpc>, IpcError> {
    Ok(state.env_store.list().into_iter().map(EnvironmentIpc::from).collect())
}

#[tauri::command]
#[specta::specta]
pub async fn env_active_get(state: State<'_, AppState>) -> Result<String, IpcError> {
    Ok(state.active_env.read().await.clone())
}

#[tauri::command]
#[specta::specta]
pub async fn env_active_set(state: State<'_, AppState>, name: String) -> Result<(), IpcError> {
    // Validate that the named env exists. Missing → InvalidTarget.
    if state.env_store.get(&name).is_none() {
        return Err(handshaker_core::error::CoreError::InvalidTarget(format!(
            "no such env: `{name}`"
        ))
        .into());
    }
    *state.active_env.write().await = name;
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn env_upsert(state: State<'_, AppState>, env: EnvironmentIpc) -> Result<(), IpcError> {
    state.env_store.upsert(Environment::from(env)).map_err(IpcError::from)
}
```

- [ ] **Step 3: Compile check**

Run: `cargo check -p handshaker`
Expected: clean (commands aren't yet registered — that's Task 12).

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/commands/env.rs src-tauri/src/commands/mod.rs
git commit -m "feat(tauri/commands): env_list/active_get/active_set/upsert"
```

---

## Task 11: IPC command `commands/vars.rs` — `vars_resolve`

**Files:**
- Create: `src-tauri/src/commands/vars.rs`
- Modify: `src-tauri/src/commands/mod.rs`

- [ ] **Step 1: Add `pub mod vars;` to `commands/mod.rs`**

`commands/mod.rs` should now contain (alphabetical):

```rust
pub mod env;
pub mod events;
pub mod grpc;
pub mod meta;
pub mod vars;
```

- [ ] **Step 2: Create `commands/vars.rs`**

Create `src-tauri/src/commands/vars.rs`:

```rust
//! Variable substitution IPC command. See spec §5.1.

use std::collections::HashMap;

use handshaker_core::vars::{resolve_template_with_diagnostics, VariableSet};
use tauri::State;

use crate::ipc::error::IpcError;
use crate::ipc::vars::ResolutionReportIpc;
use crate::state::AppState;

#[tauri::command]
#[specta::specta]
pub async fn vars_resolve(
    state: State<'_, AppState>,
    template: String,
) -> Result<ResolutionReportIpc, IpcError> {
    let active = state.active_env.read().await.clone();
    let env_owned = state
        .env_store
        .get(&active)
        .map(|e| e.variables)
        .unwrap_or_default();
    let collection_owned: HashMap<String, String> = HashMap::new(); // populated in Plan #6
    let vars = VariableSet {
        env: &env_owned,
        collection: &collection_owned,
    };
    Ok(resolve_template_with_diagnostics(&template, &vars).into())
}
```

- [ ] **Step 3: Compile check**

Run: `cargo check -p handshaker`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/commands/vars.rs src-tauri/src/commands/mod.rs
git commit -m "feat(tauri/commands): vars_resolve against active env"
```

---

## Task 12: Register commands in `lib.rs` + regenerate bindings

**Files:**
- Modify: `src-tauri/src/lib.rs`
- Regenerate: `src/ipc/bindings.ts`

- [ ] **Step 1: Update `lib.rs` imports + `collect_commands!`**

In `src-tauri/src/lib.rs`, update the imports and `specta_builder()`:

```rust
use commands::env::{env_active_get, env_active_set, env_list, env_upsert};
use commands::events::{ConnectionStateChanged, ContractUpdated};
use commands::grpc::{
    grpc_build_request_skeleton, grpc_connect, grpc_disconnect, grpc_invoke_unary,
    grpc_refresh_contract,
};
use commands::meta::app_version;
use commands::vars::vars_resolve;
```

And inside `specta_builder()`, add the five new commands to `collect_commands![]`:

```rust
        .commands(collect_commands![
            app_version,
            grpc_connect,
            grpc_disconnect,
            grpc_refresh_contract,
            grpc_invoke_unary,
            grpc_build_request_skeleton,
            env_list,
            env_active_get,
            env_active_set,
            env_upsert,
            vars_resolve,
        ])
```

- [ ] **Step 2: Compile check**

Run: `cargo check -p handshaker`
Expected: clean.

- [ ] **Step 3: Regenerate TypeScript bindings**

The `export-bindings` binary writes to `src/ipc/bindings.ts` when run in debug mode. But the canonical path is to run the dev server once (which exports bindings as a side effect of `specta_builder()` in `#[cfg(debug_assertions)]`). The dedicated binary is `src-tauri/src/bin/export_bindings.rs`. Run:

```bash
cargo run -p handshaker --bin export-bindings
```

Expected: a fresh `src/ipc/bindings.ts` with new types `EnvironmentIpc`, `ResolutionReportIpc` and new command wrappers `envList`, `envActiveGet`, `envActiveSet`, `envUpsert`, `varsResolve`.

If the bin doesn't exist or fails, inspect `src-tauri/src/bin/export_bindings.rs` and run it directly: `cargo run -p handshaker --bin export_bindings`.

- [ ] **Step 4: Sanity-check the generated bindings**

Run: `grep -E "envList|varsResolve|EnvironmentIpc|ResolutionReportIpc" src/ipc/bindings.ts | head`
Expected: at least 4 matches (one per new name).

- [ ] **Step 5: Run frontend lint to confirm no type drift**

Run: `pnpm lint`
Expected: clean.

- [ ] **Step 6: Run full Rust tests**

Run: `cargo test --workspace`
Expected: prior 50 passed + 1 ignored, plus new vars tests (17) + env tests (7) = ~74 passed + 1 ignored.

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/lib.rs src/ipc/bindings.ts
git commit -m "feat(tauri): register env_* + vars_resolve commands; regenerate bindings"
```

---

## Task 13: Frontend IPC client wrappers

**Files:**
- Modify: `src/ipc/client.ts`

- [ ] **Step 1: Inspect existing client**

Run: `cat src/ipc/client.ts` (or open). You should see typed wrappers like `grpcInvokeUnary`, `grpcConnect`, etc., wrapping calls from `bindings.ts`.

- [ ] **Step 2: Add wrappers for the 5 new commands**

In `src/ipc/client.ts`, add wrappers using the same pattern as existing ones. Example (adapt to the file's actual import style):

```ts
import {
  // ... existing imports
  envList,
  envActiveGet,
  envActiveSet,
  envUpsert,
  varsResolve,
  type EnvironmentIpc,
  type ResolutionReportIpc,
} from "./bindings";

// ... existing exports

export const ipc = {
  // ... existing methods
  envList: () => unwrap(envList()),
  envActiveGet: () => unwrap(envActiveGet()),
  envActiveSet: (name: string) => unwrap(envActiveSet(name)),
  envUpsert: (env: EnvironmentIpc) => unwrap(envUpsert(env)),
  varsResolve: (template: string) => unwrap(varsResolve(template)),
};
```

(`unwrap` is the existing error-narrowing helper — preserve whatever convention the file uses. Re-export `EnvironmentIpc` and `ResolutionReportIpc` types alongside if the file does that for other types.)

- [ ] **Step 3: Lint**

Run: `pnpm lint`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add src/ipc/client.ts
git commit -m "feat(ipc/client): wrappers for env_* and vars_resolve"
```

---

## Task 14: Monaco custom language `json-with-vars` + theme

**Files:**
- Modify: `src/lib/monaco.ts`
- Modify: `src/features/invoke/BodyEditor.tsx`
- Modify: `src/features/response/BodyView.tsx`

- [ ] **Step 1: Inspect current `monaco.ts`**

Run: `cat src/lib/monaco.ts`. Confirm it has the lazy-loader pattern from Plan #3 UI Polish (see errata #3). You'll add the custom-language registration **inside** the lazy factory so it runs after `monaco-editor` finishes loading.

- [ ] **Step 2: Register `json-with-vars` language + `handshaker-dark` theme**

Modify `src/lib/monaco.ts`. Find the lazy factory (it dynamically imports `monaco-editor`). After the `loader.config({ monaco })` call inside the factory, add language and theme registration. Adapt to the existing factory shape — the additions are:

```ts
// Inside the lazy factory, after loader.config({ monaco }):

monaco.languages.register({ id: "json-with-vars" });

monaco.languages.setLanguageConfiguration("json-with-vars", {
  brackets: [["{", "}"], ["[", "]"]],
  autoClosingPairs: [
    { open: "{", close: "}" },
    { open: "[", close: "]" },
    { open: '"', close: '"' },
  ],
  surroundingPairs: [
    { open: "{", close: "}" },
    { open: "[", close: "]" },
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

Also update the exported `MONACO_THEME` constant from `"vs-dark"` to `"handshaker-dark"`:

```ts
export const MONACO_THEME = "handshaker-dark" as const;
```

- [ ] **Step 3: Switch `BodyEditor.tsx` to new language**

In `src/features/invoke/BodyEditor.tsx`, change `defaultLanguage="json"` to `defaultLanguage="json-with-vars"`. (Theme already comes from the shared `MONACO_THEME` constant.)

- [ ] **Step 4: Leave `BodyView.tsx` on JSON (read-only doesn't need var highlighting visually)**

`BodyView` shows server responses, which don't contain `{{var}}` — no change needed.

- [ ] **Step 5: Lint**

Run: `pnpm lint`
Expected: clean.

- [ ] **Step 6: Build sanity check**

Run: `pnpm build`
Expected: clean build; Monaco chunks still split lazily.

- [ ] **Step 7: Commit**

```bash
git add src/lib/monaco.ts src/features/invoke/BodyEditor.tsx
git commit -m "feat(monaco): register json-with-vars language + handshaker-dark theme"
```

---

## Task 15: shadcn `dialog` component (if absent)

**Files:**
- Create (potentially): `src/components/ui/dialog.tsx`

- [ ] **Step 1: Check if dialog already exists**

Run: `ls src/components/ui/dialog.tsx 2>&1` (or check via Glob). If it exists, skip to Step 3.

- [ ] **Step 2: Add via shadcn CLI**

Run: `pnpm dlx shadcn@latest add dialog`
Expected: a new file `src/components/ui/dialog.tsx` plus possibly an updated `package.json` (e.g. `@radix-ui/react-dialog` if not already present).

- [ ] **Step 3: Verify build**

Run: `pnpm build`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add src/components/ui/dialog.tsx package.json pnpm-lock.yaml
git commit -m "chore(ui): add shadcn dialog component"
```

(If no changes — i.e. dialog was already present — skip the commit.)

---

## Task 16: `VariablesTable.tsx` component

**Files:**
- Create: `src/features/envs/VariablesTable.tsx`

- [ ] **Step 1: Create directory + component**

Create `src/features/envs/VariablesTable.tsx`:

```tsx
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/cn";

const NAME_RE = /^[a-zA-Z_][a-zA-Z0-9_-]*$/;

export interface VariablesTableProps {
  /** Current variables as { key -> value }. */
  value: Record<string, string>;
  /** Called on every change with the next variables map. */
  onChange: (next: Record<string, string>) => void;
}

interface Row {
  key: string;
  value: string;
  /** Stable per-row id for React keys. Empty-row always has id `"__empty__"`. */
  id: string;
}

function toRows(map: Record<string, string>): Row[] {
  return Object.entries(map).map(([k, v], i) => ({ key: k, value: v, id: `${i}-${k}` }));
}

function fromRows(rows: Row[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const r of rows) {
    if (r.id === "__empty__") continue;
    if (r.key.length === 0) continue;
    out[r.key] = r.value; // dup keys: last wins
  }
  return out;
}

export function VariablesTable({ value, onChange }: VariablesTableProps) {
  const [rows, setRows] = useState<Row[]>(() => toRows(value));

  function updateRow(idx: number, patch: Partial<Row>) {
    const next = rows.map((r, i) => (i === idx ? { ...r, ...patch } : r));
    setRows(next);
    onChange(fromRows(next));
  }

  function deleteRow(idx: number) {
    const next = rows.filter((_, i) => i !== idx);
    setRows(next);
    onChange(fromRows(next));
  }

  function materializeEmpty(key: string) {
    if (key.length === 0) return;
    const next = [...rows, { key, value: "", id: `${rows.length}-${key}` }];
    setRows(next);
    onChange(fromRows(next));
  }

  const seenKeys = new Set<string>();
  const dupFlags = rows.map((r) => {
    const dup = seenKeys.has(r.key);
    seenKeys.add(r.key);
    return dup;
  });

  return (
    <div className="space-y-1">
      <div className="grid grid-cols-[1fr_2fr_auto] gap-2 text-xs text-muted-foreground font-mono">
        <span>key</span>
        <span>value</span>
        <span aria-hidden />
      </div>
      {rows.map((r, i) => {
        const invalid = r.key.length > 0 && !NAME_RE.test(r.key);
        return (
          <div key={r.id}>
            <div className="grid grid-cols-[1fr_2fr_auto] gap-2 items-center group">
              <Input
                value={r.key}
                onChange={(e) => updateRow(i, { key: e.target.value })}
                className={cn("font-mono text-sm", invalid && "border-destructive")}
                title="key must match ^[a-zA-Z_][a-zA-Z0-9_-]*$"
              />
              <Input
                value={r.value}
                onChange={(e) => updateRow(i, { value: e.target.value })}
                className="font-mono text-sm"
              />
              <Button
                variant="ghost"
                size="icon"
                className="opacity-0 group-hover:opacity-100"
                onClick={() => deleteRow(i)}
                aria-label="delete variable"
              >
                ✕
              </Button>
            </div>
            {dupFlags[i] && (
              <div className="text-xs text-amber-500 px-1 mt-0.5">
                duplicate key — last value wins
              </div>
            )}
          </div>
        );
      })}
      {/* Empty-row */}
      <div className="grid grid-cols-[1fr_2fr_auto] gap-2 items-center">
        <Input
          value=""
          placeholder="Add variable"
          onChange={(e) => materializeEmpty(e.target.value)}
          className="font-mono text-sm"
        />
        <Input value="" disabled className="font-mono text-sm" />
        <span aria-hidden />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Lint**

Run: `pnpm lint`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/features/envs/VariablesTable.tsx
git commit -m "feat(envs): VariablesTable with empty-row, validation, dup warning"
```

---

## Task 17: `EditEnvDialog.tsx`

**Files:**
- Create: `src/features/envs/EditEnvDialog.tsx`

- [ ] **Step 1: Create dialog**

Create `src/features/envs/EditEnvDialog.tsx`:

```tsx
import { useEffect, useState } from "react";

import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ipc } from "@/ipc/client";

import { VariablesTable } from "./VariablesTable";

export interface EditEnvDialogProps {
  open: boolean;
  envName: string;
  onOpenChange: (open: boolean) => void;
  /** Called after a successful save with the updated variables. */
  onSaved: (variables: Record<string, string>) => void;
}

export function EditEnvDialog({ open, envName, onOpenChange, onSaved }: EditEnvDialogProps) {
  const [vars, setVars] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setError(null);
    // Load current variables for the env.
    (async () => {
      try {
        const envs = await ipc.envList();
        const cur = envs.find((e) => e.name === envName);
        setVars(cur?.variables ?? {});
      } catch (e) {
        const t = e as { type?: string; message?: string };
        setError(t.message ?? t.type ?? "failed to load env");
      }
    })();
  }, [open, envName]);

  async function handleSave() {
    setBusy(true);
    setError(null);
    try {
      await ipc.envUpsert({ name: envName, variables: vars });
      onSaved(vars);
      onOpenChange(false);
    } catch (e) {
      const t = e as { type?: string; message?: string };
      setError(t.message ?? t.type ?? "save failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Edit variables — {envName}</DialogTitle>
        </DialogHeader>
        <div className="py-2">
          <VariablesTable value={vars} onChange={setVars} />
        </div>
        {error && (
          <div className="border-l-2 border-destructive bg-destructive/5 px-3 py-1.5 text-xs text-destructive">
            {error}
          </div>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={busy}>
            {busy ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Lint**

Run: `pnpm lint`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/features/envs/EditEnvDialog.tsx
git commit -m "feat(envs): EditEnvDialog wires VariablesTable to env_upsert"
```

---

## Task 18: `EnvPill.tsx` + integrate into `App.tsx`

**Files:**
- Create: `src/features/envs/EnvPill.tsx`
- Modify: `src/App.tsx`

- [ ] **Step 1: Create `EnvPill.tsx`**

Create `src/features/envs/EnvPill.tsx`:

```tsx
import { ChevronDown } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";

import { EditEnvDialog } from "./EditEnvDialog";

export interface EnvPillProps {
  activeEnv: string;
  /** Called after the user saves variables in the dialog. */
  onVariablesSaved: (variables: Record<string, string>) => void;
}

export function EnvPill({ activeEnv, onVariablesSaved }: EnvPillProps) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => setOpen(true)}
        className="gap-1 font-mono"
      >
        {activeEnv}
        <ChevronDown className="w-3 h-3" aria-hidden />
      </Button>
      <EditEnvDialog
        open={open}
        envName={activeEnv}
        onOpenChange={setOpen}
        onSaved={onVariablesSaved}
      />
    </>
  );
}
```

- [ ] **Step 2: Update `App.tsx` header**

In `src/App.tsx`:

1. Add imports:

```tsx
import { EnvPill } from "@/features/envs/EnvPill";
```

2. Add state and effect for active env:

```tsx
  const [activeEnv, setActiveEnv] = useState<string>("Default");

  useEffect(() => {
    ipc.envActiveGet().then(setActiveEnv).catch(console.error);
  }, []);
```

3. Replace the existing header `<span>v{version}</span>` row to include the pill alongside the version:

```tsx
      <header className="px-6 py-3 border-b border-border flex items-center justify-between shrink-0">
        <h1 className="text-base font-semibold">Handshaker</h1>
        <div className="flex items-center gap-3">
          <span className="text-xs text-muted-foreground font-mono">v{version}</span>
          <EnvPill activeEnv={activeEnv} onVariablesSaved={() => { /* no-op: live preview re-fetches */ }} />
        </div>
      </header>
```

(The `onVariablesSaved` callback is intentionally a no-op: `ResolvesPreview` (Task 19) re-fetches via `vars_resolve` on every keystroke, so it sees the updated env automatically.)

- [ ] **Step 3: Lint + build**

Run: `pnpm lint && pnpm build`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add src/features/envs/EnvPill.tsx src/App.tsx
git commit -m "feat(app): EnvPill in header opens EditEnvDialog"
```

---

## Task 19: `ResolvesPreview.tsx`

**Files:**
- Create: `src/features/invoke/ResolvesPreview.tsx`

- [ ] **Step 1: Create component**

Create `src/features/invoke/ResolvesPreview.tsx`:

```tsx
import { useEffect, useRef, useState } from "react";

import { ipc } from "@/ipc/client";
import type { ResolutionReportIpc } from "@/ipc/bindings";

const DEBOUNCE_MS = 300;

/** Detects whether the body contains any `{{name}}` placeholder. */
function hasVars(body: string): boolean {
  return /\{\{[a-zA-Z_][a-zA-Z0-9_-]*\}\}/.test(body);
}

/** Collapse multi-line / multi-space JSON to a single line for inline display. */
function collapseInline(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

export interface ResolvesPreviewProps {
  body: string;
}

export function ResolvesPreview({ body }: ResolvesPreviewProps) {
  const [report, setReport] = useState<ResolutionReportIpc | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    // If body has no vars, hide preview entirely.
    if (!hasVars(body)) {
      setReport(null);
      return;
    }
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      ipc.varsResolve(body).then(setReport).catch(() => setReport(null));
    }, DEBOUNCE_MS);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [body]);

  if (!hasVars(body) || report === null) return null;

  if (report.cycle_chain) {
    return (
      <div className="px-4 py-1 text-xs font-mono text-destructive overflow-hidden text-ellipsis whitespace-nowrap"
           title={`Cycle: ${report.cycle_chain.join(" → ")}`}>
        ⚠ Cycle: {report.cycle_chain.join(" → ")}
      </div>
    );
  }
  if (report.unresolved_vars.length > 0) {
    const list = report.unresolved_vars.join(", ");
    return (
      <div className="px-4 py-1 text-xs font-mono text-destructive overflow-hidden text-ellipsis whitespace-nowrap"
           title={`Unresolved: ${list}`}>
        ⚠ Unresolved: {list}
      </div>
    );
  }
  const inline = collapseInline(report.resolved);
  return (
    <div className="px-4 py-1 text-xs font-mono text-muted-foreground overflow-hidden text-ellipsis whitespace-nowrap"
         title={report.resolved}>
      → resolves: {inline}
    </div>
  );
}
```

- [ ] **Step 2: Lint**

Run: `pnpm lint`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/features/invoke/ResolvesPreview.tsx
git commit -m "feat(invoke): ResolvesPreview debounced live var preview"
```

---

## Task 20: Modify `InvokePanel` — render preview + resolve-before-send

**Files:**
- Modify: `src/features/invoke/InvokePanel.tsx`

- [ ] **Step 1: Add `ResolvesPreview` to layout**

In `src/features/invoke/InvokePanel.tsx`, add the import:

```tsx
import { ResolvesPreview } from "./ResolvesPreview";
```

Replace the inner JSX body wrapping `<BodyEditor>` so the preview renders below the editor:

```tsx
      <div className="flex-1 min-h-0 flex flex-col">
        <div className="flex-1 min-h-0">
          <BodyEditor value={body} onChange={setBody} />
        </div>
        <ResolvesPreview body={body} />
      </div>
```

(The outer `<div className="flex-1 min-h-0">` previously wrapped only `<BodyEditor>`; we now add a flex column inside it to host preview as a non-stretching row below.)

- [ ] **Step 2: Modify `handleSend` to resolve first**

Replace the entire `handleSend` function in `InvokePanel.tsx` with:

```tsx
  async function handleSend() {
    // Local JSON validation — produces a better error than a backend round-trip.
    try {
      JSON.parse(body);
    } catch (e) {
      onError(`Invalid JSON: ${(e as Error).message}`);
      return;
    }

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

- [ ] **Step 3: Lint + build**

Run: `pnpm lint && pnpm build`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add src/features/invoke/InvokePanel.tsx
git commit -m "feat(invoke): vars_resolve before send + ResolvesPreview in layout"
```

---

## Task 21: Manual UI smoke + final verification

**Files:** none (verification only).

- [ ] **Step 1: Run full Rust test suite**

Run: `cargo test --workspace`
Expected: all tests pass (prior 50 + new vars 17 + env 7 = ~74). 1 ignored (`invoke_live`).

- [ ] **Step 2: Frontend lint + build**

Run: `pnpm lint && pnpm build`
Expected: clean.

- [ ] **Step 3: Start dev server**

Run: `cargo tauri dev`

Then walk through the manual smoke per spec §9.4. Each numbered step matches the spec's checklist:

- [ ] **Step 4: Header pill present**

`Default ▾` is visible right-aligned in the header, next to `v{version}`.

- [ ] **Step 5: Open dialog**

Click pill → dialog opens, title `Edit variables — Default`, empty key/value table with one empty-row.

- [ ] **Step 6: Add variables**

Type `uid` / `abc-123` in the empty-row → row materializes, a new empty-row appears. Add `env_label` / `production`. Save → dialog closes.

- [ ] **Step 7: Reopen dialog → variables persist**

Click pill again — both rows visible.

- [ ] **Step 8: Connect & pick a method**

Connect to `127.0.0.1:5002` (Notex testbed from prior plans). Pick any unary method.

- [ ] **Step 9: Body editor uses `json-with-vars`**

Type `{"user_id":"{{uid}}"}` → `{{uid}}` is rendered in warm yellow bold.

- [ ] **Step 10: Live preview**

Below the editor: `→ resolves: {"user_id":"abc-123"}` appears within ~300 ms of typing settling.

- [ ] **Step 11: Unresolved variable**

Edit body to `{"x":"{{missing}}"}` → preview turns red: `⚠ Unresolved: missing`.

- [ ] **Step 12: Send with unresolved → blocked**

Click Send → response area shows inline red error "Unresolved variables: missing"; no request sent.

- [ ] **Step 13: Cycle**

Open dialog, add `a = {{b}}`, `b = {{a}}`. Body `{{a}}`. Preview: `⚠ Cycle: a → b → a` (or similar back-edge chain). Send → response area shows "Variable cycle: a → b → a".

- [ ] **Step 14: Happy path**

Restore body to `{"user_id":"{{uid}}"}`. Send → server receives `{"user_id":"abc-123"}`, response OK.

- [ ] **Step 15: `{{1bad}}` literal**

Body contains `"{{1bad}}"` (digit-leading) → no highlight, no preview line (regex didn't match), no error.

- [ ] **Step 16: Regression sweep**

- Ctrl+Enter / ⌘↵ still Sends.
- Tabs `Body | Trailers (n)` still work.
- ConnectPanel address still resolves connection.

- [ ] **Step 17: Optional — re-run ignored live test**

```bash
HANDSHAKER_LIVE_TARGET=127.0.0.1:5002 cargo test --workspace -- --ignored
```

Expected: `invoke_live` passes against the testbed.

- [ ] **Step 18: Write an errata file if any deviation surfaced**

If during manual smoke you needed to deviate from any spec section (e.g. you found Monaco grammar missed an edge case, or had to add a workaround), create `docs/superpowers/errata/2026-05-27-plan-04-env-vars.md` documenting it, modeled after the Plan #3 UI Polish errata. Commit separately.

- [ ] **Step 19: Final commit (if any errata)**

Only if you wrote an errata:

```bash
git add docs/superpowers/errata/2026-05-27-plan-04-env-vars.md
git commit -m "docs(errata): Plan #4 Env + Vars — deviations from spec"
```

---

## Acceptance criteria recap

Plan #4 is "done" when:

1. `cargo test --workspace` → all pass (+1 ignored).
2. `pnpm lint && pnpm build` → clean.
3. Manual smoke §9.4 of the spec → all 14 steps pass.
4. New commands present in `src/ipc/bindings.ts`: `envList`, `envActiveGet`, `envActiveSet`, `envUpsert`, `varsResolve`.
5. No changes to `CoreError` or `IpcError` enums.
6. `127.0.0.1:5002` smoke against the Notex testbed passes — body with `{{uid}}` substituted at send time.

Branch state at completion: ~22 small commits on `claude/plan-04-env-vars`, ready for merge to `main`.
