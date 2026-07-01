# Single Resolve Pipeline — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Route the live gRPC Send path through the core `resolve_request` pipeline, deleting the untested TypeScript mirror (`pickEffectiveAuth`/`resolveAuthHeader`/`resolveOauthConfig`/`resolveStepTemplates`) so one tested resolver owns variables, TLS, metadata, and auth.

**Architecture:** Core `resolve_request` becomes async, takes an optional collection and a `TokenSource` seam, materializes OAuth2 tokens itself, and reports every unresolved variable at once. A new IPC command `grpc_send(draft, ctx, request_id, opts)` owns the chain resolve → expand-builtins → invoke → invalidate-on-16. The frontend shrinks to "call the command, map the result" and asks the core for effective auth via `auth_effective` instead of recomputing the pick rule. See ADR [`docs/adr/0001-send-resolves-in-core.md`](../../adr/0001-send-resolves-in-core.md) and spec [`docs/superpowers/specs/2026-07-02-single-resolve-pipeline-design.md`](../specs/2026-07-02-single-resolve-pipeline-design.md).

**Tech Stack:** Rust (handshaker-core + tauri src-tauri, `async_trait`, `tokio`, `wiremock` for token tests), React 18 + TypeScript (vitest), tauri-specta bindings.

## Global Constraints

- **Gate (every task):** the task's own tests green, and no regressions in the workspace suite it touches. **Whole-feature gate** (run before declaring a slice done): `cargo test --workspace` — **including the crate-level `crates/handshaker-core/tests/` integration directory** (the traceId lesson: a unit-only grep misses stale assertions in `tests/*.rs`) · `pnpm test` (vitest) · `tsc -b` · `vite build` · bindings no-drift.
- **Bindings drift is intentional and committed.** New commands (`grpc_send`, `auth_effective`), the removed `grpc_invoke_oneshot`, and new wire types (`CallOptionsIpc`, `SendDraftIpc`, `SendCtxIpc`, `EffectiveAuthIpc`) change `src/ipc/bindings.ts`. Regenerate and commit the diff; the no-drift check must be green *after* regeneration (a second run produces no further diff).
- **User-facing strings live in `src/lib/messages.ts`** (rule `.claude/rules/ui-strings.md`), never inline in components. Error copy for unresolved-vars uses the existing message shape.
- **Fresh worktree:** `pnpm install`, then build `dist/` before compiling `src-tauri` (`generate_context!` needs `dist/`).
- **specta forbids `u64`/BigInt at the IPC boundary** — wire integers are `u32` (mirror the existing `elapsed_ms`/`timeout_ms` clamps).
- **Regenerate bindings** with the project's existing export-bindings helper after any `#[specta::specta]` command or `Type` DTO change.

---

## File Structure

**Core (`crates/handshaker-core/`)**
- `src/auth/mod.rs` — add `pick_auth_config` (pure pick) + `materialize_env_var`; delete sync `resolve_auth` + its OAuth2 `NotImplemented` stub (Slice 1 adds pick; Slice 3 removes stub).
- `src/auth/oauth2.rs` — add `TokenSource` trait + `impl TokenSource for Oauth2TokenProvider`; add a test fake.
- `src/collections/resolve.rs` — `ResolveFailure` accumulation, `Option<&Collection>`, async signature + `&dyn TokenSource`, oauth field-resolution, `EffectiveRequest.invalidate_oauth`.
- `src/collections/mod.rs` — extend `EffectiveRequest` with `invalidate_oauth: Option<OAuth2ClientCredentialsConfig>`.
- `src/error.rs` — add `CoreError::ResolveFailed { unresolved, cycle }`.
- `src/grpc/invoke/mod.rs` + `src/grpc/transport/{mod,tonic_impl}.rs` — `CallOptions` replaces `max_message_bytes: usize`.

**IPC (`src-tauri/`)**
- `src/ipc/invoke.rs` — `CallOptionsIpc`, `SendDraftIpc`.
- `src/ipc/target.rs`, `src/ipc/vars.rs` — reuse; add `SendCtxIpc` (new small module `src/ipc/send.rs` or in `invoke.rs`).
- `src/ipc/auth.rs` — `EffectiveAuthIpc` (or reuse `SavedAuthConfigIpc`).
- `src/ipc/error.rs` — `IpcError::UnresolvedVars` + `From<CoreError>` arm + count bump.
- `src/commands/grpc.rs` — `grpc_send` replaces `grpc_invoke_oneshot`; `CallOptions` threading.
- `src/commands/auth.rs` — `auth_effective` command; rewire `auth_resolve_impl` off deleted `resolve_auth`.
- `src/state.rs` — `oauth2_provider` already present; expose as `&dyn TokenSource`.
- `src/lib.rs` — swap command registration.

**Frontend (`src/`)**
- `src/features/workflow/actions.ts` — shrink `sendStep`; delete `pickEffectiveAuth`, `resolveAuthHeader`, `resolveOauthConfig`, `AuthDeps`.
- `src/features/workflow/resolve.ts` — **deleted** (+ `resolve.test.ts`).
- `src/features/workflow/resolveAuthHeader.test.ts` — **deleted**.
- `src/features/workflow/useEffectiveAuth.ts` — **new** hook (Slice 4).
- `src/features/workflow/CallPanel.tsx`, `FocusView.tsx`, `useDraftReflection.ts`, `useMessageSchema.ts` — consume `auth_effective`, thread `skipVerify`.
- `src/ipc/client.ts` — `grpcSend`, `authEffective`; drop `grpcInvokeOneshot`.
- `src/lib/messages.ts` — unresolved-vars copy if not already centralized.

---

# Slice 1 — Core prefactor: pick/materialize split + full resolve report (Issue #1)

No external behavior change; IPC untouched. Deliverable: the pick rule exists once as a pure function, resolve reports **all** unresolved vars at once, and an unbound draft resolves.

### Task 1.1: `pick_auth_config` pure pick function

**Files:**
- Modify: `crates/handshaker-core/src/auth/mod.rs`
- Test: same file `#[cfg(test)] mod tests`

**Interfaces:**
- Produces: `pub fn pick_auth_config<'a>(request_auth: &'a SavedAuthConfig, collection_auth: Option<&'a SavedAuthConfig>, active_env: Option<&str>) -> Option<&'a SavedAuthConfig>`

- [ ] **Step 1: Write the failing tests**

```rust
#[test]
fn pick_prefers_request_over_collection() {
    let req = SavedAuthConfig::EnvVar(EnvVarAuthConfig {
        env_var: "R".into(), header_name: "authorization".into(),
        prefix: "Bearer ".into(), environments: vec![],
    });
    let coll = SavedAuthConfig::EnvVar(EnvVarAuthConfig {
        env_var: "C".into(), header_name: "authorization".into(),
        prefix: "Bearer ".into(), environments: vec![],
    });
    let picked = pick_auth_config(&req, Some(&coll), Some("prod")).unwrap();
    match picked {
        SavedAuthConfig::EnvVar(c) => assert_eq!(c.env_var, "R"),
        other => panic!("expected request env_var, got {other:?}"),
    }
}

#[test]
fn pick_falls_back_to_collection_when_request_none() {
    let coll = SavedAuthConfig::EnvVar(EnvVarAuthConfig {
        env_var: "C".into(), header_name: "authorization".into(),
        prefix: "Bearer ".into(), environments: vec![],
    });
    let picked = pick_auth_config(&SavedAuthConfig::None, Some(&coll), None).unwrap();
    assert!(matches!(picked, SavedAuthConfig::EnvVar(c) if c.env_var == "C"));
}

#[test]
fn pick_gates_scoped_config_out_of_other_env() {
    let coll = SavedAuthConfig::EnvVar(EnvVarAuthConfig {
        env_var: "C".into(), header_name: "authorization".into(),
        prefix: "Bearer ".into(), environments: vec!["prod".into()],
    });
    assert!(pick_auth_config(&SavedAuthConfig::None, Some(&coll), Some("dev")).is_none());
    assert!(pick_auth_config(&SavedAuthConfig::None, Some(&coll), None).is_none()); // "No environment"
    assert!(pick_auth_config(&SavedAuthConfig::None, Some(&coll), Some("prod")).is_some());
}

#[test]
fn pick_none_everywhere_is_none() {
    assert!(pick_auth_config(&SavedAuthConfig::None, Some(&SavedAuthConfig::None), Some("prod")).is_none());
    assert!(pick_auth_config(&SavedAuthConfig::None, None, Some("prod")).is_none());
}
```

- [ ] **Step 2: Run to verify fail**

Run: `cargo test -p handshaker-core auth::tests::pick_ -- --nocapture`
Expected: FAIL — `pick_auth_config` not found.

- [ ] **Step 3: Implement**

Add to `auth/mod.rs`:

```rust
/// Pure pick: nearest active non-`None` config wins along request → collection.
/// A config scoped to environments not including `active_env` is skipped (treated
/// as absent). Returns the winning config by reference, or `None` (unauthenticated).
/// This is the single home of the auth-pick rule — UI asks via IPC, never re-derives.
pub fn pick_auth_config<'a>(
    request_auth: &'a SavedAuthConfig,
    collection_auth: Option<&'a SavedAuthConfig>,
    active_env: Option<&str>,
) -> Option<&'a SavedAuthConfig> {
    for cfg in [Some(request_auth), collection_auth].into_iter().flatten() {
        let envs: &[String] = match cfg {
            SavedAuthConfig::None => continue,
            SavedAuthConfig::EnvVar(c) => &c.environments,
            SavedAuthConfig::OAuth2ClientCredentials(c) => &c.environments,
        };
        if auth_active_for_env(envs, active_env) {
            return Some(cfg);
        }
    }
    None
}
```

- [ ] **Step 4: Run to verify pass**

Run: `cargo test -p handshaker-core auth::tests::pick_`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add crates/handshaker-core/src/auth/mod.rs
git commit -m "feat(core): pure pick_auth_config (auth pick, single home of the rule)"
```

### Task 1.2: `ResolveFailure` + full-report accumulation in `resolve_request`

**Files:**
- Modify: `crates/handshaker-core/src/error.rs`, `crates/handshaker-core/src/collections/resolve.rs`
- Test: `resolve.rs` tests

**Interfaces:**
- Consumes: `pick_auth_config` (Task 1.1); `resolve_template_with_diagnostics` + `ResolutionReport` from `crate::vars`.
- Produces:
  - `CoreError::ResolveFailed { unresolved: Vec<String>, cycle: Option<Vec<String>> }`
  - `resolve_request(request: &SavedRequest, collection: Option<&Collection>, active_env: Option<&Environment>) -> Result<EffectiveRequest, CoreError>` (still **sync** in this slice; auth still via existing sync path)

- [ ] **Step 1: Add the error variant**

In `crates/handshaker-core/src/error.rs`, add to `CoreError`:

```rust
    /// Resolve pipeline gathered every unresolved `{{var}}` at once (deduped, encounter
    /// order) plus a cycle chain if one was detected. Unlike `UnresolvedVariable`, this
    /// is the whole diagnosis, not the first failure.
    ResolveFailed { unresolved: Vec<String>, cycle: Option<Vec<String>> },
```

- [ ] **Step 2: Write the failing tests**

Replace the two fail-fast tests (`unresolved_variable_errors`, `variable_cycle_errors`) in `resolve.rs` and add a report test. Note all existing call sites change `&coll` → `Some(&coll)` (Task 1.3 handles the signature; write these tests against the new signature now):

```rust
#[test]
fn resolve_failure_reports_all_unresolved_at_once() {
    let coll = base_collection(&[]); // nothing defined
    let active = env("prod", &[]);
    let mut req = base_request();
    req.address_template = "{{host}}".into();
    req.body_template = r#"{"id":"{{uid}}","x":"{{host}}"}"#.into();
    req.metadata = vec![MetadataRow { key: "k".into(), value: "{{tok}}".into(), enabled: true }];
    match resolve_request(&req, Some(&coll), Some(&active)).unwrap_err() {
        CoreError::ResolveFailed { unresolved, cycle } => {
            assert_eq!(cycle, None);
            // deduped, encounter order across address, body, metadata
            assert_eq!(unresolved, vec!["host".to_string(), "uid".to_string(), "tok".to_string()]);
        }
        other => panic!("expected ResolveFailed, got {other:?}"),
    }
}

#[test]
fn resolve_failure_reports_cycle() {
    let mut coll = base_collection(&[]);
    coll.variables.insert("a".into(), "{{b}}".into());
    coll.variables.insert("b".into(), "{{a}}".into());
    let active = env("prod", &[]);
    let mut req = base_request();
    req.address_template = "{{a}}".into();
    req.body_template = "{}".into();
    match resolve_request(&req, Some(&coll), Some(&active)).unwrap_err() {
        CoreError::ResolveFailed { cycle: Some(chain), .. } => {
            assert_eq!(chain.first(), chain.last());
        }
        other => panic!("expected ResolveFailed cycle, got {other:?}"),
    }
}

#[test]
fn builtin_in_body_is_not_unresolved() {
    let coll = base_collection(&[("host", "h:1")]);
    let active = env("prod", &[]);
    let mut req = base_request();
    req.body_template = r#"{"id":"{{$guid}}"}"#.into();
    let eff = resolve_request(&req, Some(&coll), Some(&active)).unwrap();
    assert_eq!(eff.body_json, r#"{"id":"{{$guid}}"}"#); // left literal for send-time expansion
}
```

- [ ] **Step 3: Run to verify fail**

Run: `cargo test -p handshaker-core --lib collections::resolve`
Expected: FAIL — signature/behavior mismatch (and the old two tests are gone).

- [ ] **Step 4: Implement the accumulator + sync signature change**

Rewrite the field-resolution section of `resolve_request`. Replace the strict `resolve_string` calls with a diagnostic accumulator (mirror of TS `resolveStepTemplates`). Change the collection param to `Option<&Collection>`:

```rust
pub fn resolve_request(
    request: &SavedRequest,
    collection: Option<&Collection>,
    active_env: Option<&Environment>,
) -> Result<EffectiveRequest, CoreError> {
    let env_vars: HashMap<String, String> = active_env
        .map(|e| e.variables.iter().map(|(k, v)| (k.clone(), v.clone())).collect())
        .unwrap_or_default();
    let collection_vars: HashMap<String, String> = collection
        .map(|c| c.variables.iter().map(|(k, v)| (k.clone(), v.clone())).collect())
        .unwrap_or_default();
    let vars = VariableSet { env: &env_vars, collection: &collection_vars };

    let mut acc = ResolveAcc::default();
    let address = acc.take(&request.address_template, &vars);
    let body_json = acc.take(&request.body_template, &vars);
    let mut metadata = HashMap::with_capacity(request.metadata.len());
    for row in &request.metadata {
        if !row.enabled { continue; }
        metadata.insert(row.key.clone(), acc.take(&row.value, &vars));
    }
    if let Some(err) = acc.into_failure() {
        return Err(err);
    }

    let default_tls = collection.map_or(false, |c| c.default_tls);
    let skip_verify = collection.map_or(false, |c| c.skip_tls_verify);
    let tls = request.tls_override.unwrap_or(default_tls);
    let target = GrpcTarget::new(address, tls, skip_verify)?;

    let collection_auth = collection.map(|c| &c.auth);
    let auth = match pick_auth_config(&request.auth, collection_auth, active_env.map(|e| e.name.as_str())) {
        Some(cfg) => resolve_auth(cfg)?, // sync path unchanged in this slice
        None => None,
    };

    Ok(EffectiveRequest { target, service: request.service.clone(),
        method: request.method.clone(), body_json, metadata, auth })
}

/// Accumulates unresolved vars (deduped, encounter order) + first cycle across fields.
#[derive(Default)]
struct ResolveAcc {
    unresolved: Vec<String>,
    cycle: Option<Vec<String>>,
}
impl ResolveAcc {
    fn take(&mut self, template: &str, vars: &VariableSet<'_>) -> String {
        let report = resolve_template_with_diagnostics(template, vars);
        for v in report.unresolved_vars {
            if !self.unresolved.iter().any(|n| n == &v) { self.unresolved.push(v); }
        }
        if self.cycle.is_none() { self.cycle = report.cycle_chain; }
        report.resolved
    }
    fn into_failure(self) -> Option<CoreError> {
        if self.cycle.is_some() || !self.unresolved.is_empty() {
            Some(CoreError::ResolveFailed { unresolved: self.unresolved, cycle: self.cycle })
        } else {
            None
        }
    }
}
```

Update imports: `use crate::vars::{resolve_template_with_diagnostics, VariableSet};` (drop `resolve_string`). Delete the now-unused `resolve_auth_chain` helper (its pick logic moved to `pick_auth_config`). Update all in-module tests that call `resolve_request(&req, &coll, …)` to `resolve_request(&req, Some(&coll), …)`.

- [ ] **Step 5: Run to verify pass**

Run: `cargo test -p handshaker-core --lib collections::resolve`
Expected: PASS.

- [ ] **Step 6: Update the IPC error mapping so the workspace still compiles**

`CoreError::ResolveFailed` is a new variant → the exhaustive `From<CoreError> for IpcError` in `src-tauri/src/ipc/error.rs` won't compile. Add a temporary arm (the real `UnresolvedVars` variant lands in Slice 5; for now map to the existing shape so the tree builds):

```rust
CoreError::ResolveFailed { unresolved, cycle } => match cycle {
    Some(chain) => IpcError::VariableCycle { chain },
    None => IpcError::UnresolvedVariable {
        name: unresolved.into_iter().next().unwrap_or_default(),
    },
},
```

Bump the `cases.len()` assertion in `from_core_error_exhaustive` (16 → 17) and add `CoreError::ResolveFailed { unresolved: vec!["v".into()], cycle: None }` to its `cases` vec.

- [ ] **Step 7: Run workspace gate**

Run: `cargo test --workspace`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add crates/handshaker-core/src/error.rs crates/handshaker-core/src/collections/resolve.rs src-tauri/src/ipc/error.rs
git commit -m "feat(core): resolve_request gathers full ResolveFailure + optional collection"
```

### Task 1.3: unbound-draft resolve test (guardrail)

**Files:**
- Test: `crates/handshaker-core/src/collections/resolve.rs`

- [ ] **Step 1: Write the failing test**

```rust
#[test]
fn resolves_unbound_draft_with_no_collection() {
    // No collection: empty collection vars, no collection auth, verify on (skip=false).
    let active = env("prod", &[("host", "api:443")]);
    let mut req = base_request();
    req.address_template = "{{host}}".into();
    req.body_template = "{}".into();
    let eff = resolve_request(&req, None, Some(&active)).unwrap();
    assert_eq!(eff.target.address, "api:443");
    assert!(!eff.target.skip_verify);
    assert!(eff.auth.is_none());
}
```

(If `GrpcTarget` exposes `skip_verify` under a different accessor, assert via the field the type provides.)

- [ ] **Step 2: Run — expect PASS** (Task 1.2 already implemented `Option<&Collection>`).

Run: `cargo test -p handshaker-core --lib collections::resolve::resolves_unbound_draft`
Expected: PASS. (This task is a regression guard, not new code.)

- [ ] **Step 3: Commit**

```bash
git add crates/handshaker-core/src/collections/resolve.rs
git commit -m "test(core): unbound-draft resolve (no collection)"
```

**Slice 1 gate:** `cargo test --workspace` green.

---

# Slice 2 — CallOptions: per-call options as one value (Issue #2)

Independent of Slice 1. Deliverable: `invoke_unary` + transport take one `CallOptions`; the wire `CallOptionsIpc { timeout_ms, max_message_bytes }` reaches the command; the frontend assembles options in one place.

### Task 2.1: core `CallOptions` through invoke + transport

**Files:**
- Modify: `crates/handshaker-core/src/grpc/invoke/mod.rs`, `crates/handshaker-core/src/grpc/transport/mod.rs`, `crates/handshaker-core/src/grpc/transport/tonic_impl.rs`
- Modify (re-export): `crates/handshaker-core/src/grpc/mod.rs`
- Test: `crates/handshaker-core/tests/invoke_unary.rs` (integration) + any transport unit tests

**Interfaces:**
- Produces:
  - `pub struct CallOptions { pub max_message_bytes: usize }` (in `grpc/invoke/mod.rs`, re-exported from `grpc`)
  - `invoke_unary(connection, service, method, request_json, metadata, opts: CallOptions)`
  - `GrpcTransport::unary_dynamic(channel, method_path, codec, request, metadata, opts: CallOptions)`

- [ ] **Step 1: Write/adjust the failing test**

In `crates/handshaker-core/tests/invoke_unary.rs`, change the `invoke_unary(...)` call to pass `CallOptions { max_message_bytes: usize::MAX }` instead of the bare `usize`. Add an assertion-free compile guard is enough; the behavioral limit test already exists.

- [ ] **Step 2: Run to verify fail**

Run: `cargo test -p handshaker-core --test invoke_unary`
Expected: FAIL to compile — `CallOptions` not found.

- [ ] **Step 3: Implement**

In `grpc/invoke/mod.rs`:

```rust
/// Per-call invoke options — one growing value threaded UI→transport instead of
/// positional params. `request_id` is NOT here (cancel key, separate lifecycle).
#[derive(Debug, Clone, Copy)]
pub struct CallOptions {
    /// Max decode/encode message size in bytes (`usize::MAX` = unlimited).
    pub max_message_bytes: usize,
}
```

Change `invoke_unary`'s last param to `opts: CallOptions` and pass `opts` to `unary_dynamic`. Change the `GrpcTransport::unary_dynamic` trait signature's last param to `opts: CallOptions`; in `tonic_impl.rs` read `opts.max_message_bytes` where `max_message_bytes` was used. Re-export `CallOptions` from `grpc/mod.rs` alongside the other invoke exports. Update the `_trait_has_unary_dynamic` compile-check in `transport/mod.rs` and any `FakeTransport` test impl (search `invoke/mod.rs` tests + `tests/invoke_*.rs`) to the new signature.

- [ ] **Step 4: Run to verify pass**

Run: `cargo test -p handshaker-core`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add crates/handshaker-core/src/grpc
git commit -m "feat(core): CallOptions replaces positional max_message_bytes in invoke+transport"
```

### Task 2.2: wire `CallOptionsIpc` + command threading + frontend assembly

**Files:**
- Modify: `src-tauri/src/ipc/invoke.rs` (add `CallOptionsIpc`), `src-tauri/src/commands/grpc.rs` (`grpc_invoke_oneshot` signature), `src-tauri/src/ipc/mod.rs` (export)
- Modify: `src/ipc/client.ts`, `src/features/workflow/actions.ts`
- Test: `src-tauri/src/commands/grpc.rs` tests, `src/features/workflow/actions.test.ts`

**Interfaces:**
- Consumes: core `CallOptions`, `resolve_max_message_size` (existing in `grpc.rs`).
- Produces:
  - `CallOptionsIpc { timeout_ms: u32, max_message_bytes: u32 }` (Deserialize + Type)
  - `grpc_invoke_oneshot(state, target, request, request_id, opts: CallOptionsIpc)` (timeout peeled for the race; core `CallOptions` built from `max_message_bytes`)
  - TS `grpcInvokeOneshot(target, req, requestId, opts: { timeout_ms; max_message_bytes })`

- [ ] **Step 1: Write the failing Rust test**

In `grpc.rs` tests, add a mapping check:

```rust
#[test]
fn call_options_ipc_maps_zero_bytes_to_unlimited() {
    let core = CallOptions { max_message_bytes: resolve_max_message_size(0) };
    assert_eq!(core.max_message_bytes, usize::MAX);
}
```

- [ ] **Step 2: Run — expect FAIL** (`CallOptions`/import missing in `grpc.rs`).

Run: `cargo test -p handshaker-tauri call_options_ipc` (use the crate's actual package name from `src-tauri/Cargo.toml`).
Expected: FAIL.

- [ ] **Step 3: Implement wire type + command**

`ipc/invoke.rs`:

```rust
#[derive(Debug, Deserialize, Type)]
pub struct CallOptionsIpc {
    pub timeout_ms: u32,
    pub max_message_bytes: u32,
}
```

`commands/grpc.rs` — change `grpc_invoke_oneshot` signature to `(state, target, request, request_id, opts: CallOptionsIpc)`. Peel `opts.timeout_ms` for `race_cancel_timeout`; inside `work`, build `CallOptions { max_message_bytes: resolve_max_message_size(opts.max_message_bytes) }` and pass to `invoke_unary`. Export `CallOptionsIpc` from `ipc/mod.rs`.

- [ ] **Step 4: Frontend assembly**

`src/ipc/client.ts` — change `grpcInvokeOneshot` to take `opts: { timeout_ms: number; max_message_bytes: number }` and pass it as the last arg to `commands.grpcInvokeOneshot`. `src/features/workflow/actions.ts` `sendStep` — build the opts object once from `readPrefs()` (`requestTimeoutMs`, `maxMessageBytes`) and pass it. Regenerate bindings.

- [ ] **Step 5: Run to verify pass**

Run: `cargo test -p handshaker && pnpm test src/features/workflow/actions && tsc -b`
Expected: PASS. Bindings no-drift after regen.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/ipc src-tauri/src/commands/grpc.rs src/ipc/client.ts src/features/workflow/actions.ts src/ipc/bindings.ts
git commit -m "feat(ipc): CallOptionsIpc threads timeout+size as one wire value"
```

**Slice 2 gate:** `cargo test --workspace` · vitest · `tsc -b` · `vite build` · bindings no-drift.

---

# Slice 3 — TokenSource seam + async resolve pipeline (Issue #3, blocked by #1)

Deliverable: `resolve_request` is async, materializes OAuth2 via a `TokenSource` seam (two adapters: real provider + test fake), resolves oauth `{{var}}` fields in core before the token fetch, and the sync `NotImplemented` stub is gone.

### Task 3.1: `TokenSource` trait + provider impl + test fake

**Files:**
- Modify: `crates/handshaker-core/src/auth/oauth2.rs`
- Test: `oauth2.rs` tests

**Interfaces:**
- Produces:
  - `#[async_trait] pub trait TokenSource: Send + Sync { async fn header_for(&self, cfg: &OAuth2ClientCredentialsConfig) -> Result<AuthCredentials, CoreError>; fn invalidate(&self, cfg: &OAuth2ClientCredentialsConfig); }`
  - `impl TokenSource for Oauth2TokenProvider`
  - test fake `FakeTokenSource`

- [ ] **Step 1: Write the failing test**

```rust
#[tokio::test]
async fn provider_satisfies_token_source_trait() {
    let provider = Oauth2TokenProvider::new();
    let c = cfg();
    provider.seed_for_test(&c, "abc", Duration::from_secs(600));
    let src: &dyn TokenSource = &provider;
    let creds = src.header_for(&c).await.unwrap();
    assert_eq!(creds.header_value, "Bearer abc");
    src.invalidate(&c);
    assert!(!provider.has_cached_for_test(&c));
}
```

- [ ] **Step 2: Run — expect FAIL** (`TokenSource` not found).

Run: `cargo test -p handshaker-core auth::oauth2::tests::provider_satisfies`
Expected: FAIL.

- [ ] **Step 3: Implement**

In `oauth2.rs` (module already `use`s `async_trait` transitively via transport? add `use async_trait::async_trait;`):

```rust
/// Seam: materialize an OAuth2 header from an already-resolved config. Two adapters:
/// the real cached provider and a test fake (oauth resolve tests run without network).
#[async_trait::async_trait]
pub trait TokenSource: Send + Sync {
    async fn header_for(&self, cfg: &OAuth2ClientCredentialsConfig) -> Result<AuthCredentials, CoreError>;
    fn invalidate(&self, cfg: &OAuth2ClientCredentialsConfig);
}

#[async_trait::async_trait]
impl TokenSource for Oauth2TokenProvider {
    async fn header_for(&self, cfg: &OAuth2ClientCredentialsConfig) -> Result<AuthCredentials, CoreError> {
        Oauth2TokenProvider::header_for(self, cfg).await
    }
    fn invalidate(&self, cfg: &OAuth2ClientCredentialsConfig) {
        Oauth2TokenProvider::invalidate(self, cfg);
    }
}
```

Add the fake under `#[cfg(test)]` (also needed by `resolve.rs` tests — put a reusable fake in a small `#[cfg(any(test, feature = "test-util"))]`? Simpler: define `FakeTokenSource` in `oauth2.rs` under `#[cfg(test)]` and a mirror in resolve.rs tests, OR expose a `pub` test helper). Decision: define `pub struct StaticTokenSource { pub header: AuthCredentials }` **not** cfg-gated (tiny, harmless, lets `resolve.rs` tests reuse it):

```rust
/// A fixed-header token source — for tests and any caller that already holds a token.
pub struct StaticTokenSource {
    pub header: AuthCredentials,
}
#[async_trait::async_trait]
impl TokenSource for StaticTokenSource {
    async fn header_for(&self, _cfg: &OAuth2ClientCredentialsConfig) -> Result<AuthCredentials, CoreError> {
        Ok(self.header.clone())
    }
    fn invalidate(&self, _cfg: &OAuth2ClientCredentialsConfig) {}
}
```

Re-export `TokenSource` + `StaticTokenSource` from `auth/mod.rs` (`pub use oauth2::{TokenSource, StaticTokenSource};`).

- [ ] **Step 4: Run — expect PASS.**

Run: `cargo test -p handshaker-core auth::oauth2`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add crates/handshaker-core/src/auth
git commit -m "feat(core): TokenSource seam (real provider + static fake adapter)"
```

### Task 3.2: async `resolve_request` with oauth materialization; delete sync stub

**Files:**
- Modify: `crates/handshaker-core/src/collections/resolve.rs`, `crates/handshaker-core/src/collections/mod.rs` (EffectiveRequest field), `crates/handshaker-core/src/auth/mod.rs` (delete `resolve_auth` + add `materialize_env_var`), `src-tauri/src/commands/auth.rs` (rewire `auth_resolve_impl`)
- Test: `resolve.rs` tests

**Interfaces:**
- Consumes: `TokenSource`, `StaticTokenSource`, `pick_auth_config`.
- Produces:
  - `EffectiveRequest.invalidate_oauth: Option<OAuth2ClientCredentialsConfig>` (the resolved config whose token was used; `None` for non-oauth)
  - `async fn resolve_request(request, collection: Option<&Collection>, active_env: Option<&Environment>, tokens: &dyn TokenSource) -> Result<EffectiveRequest, CoreError>`
  - `pub fn materialize_env_var(cfg: &EnvVarAuthConfig) -> Result<AuthCredentials, CoreError>`
  - **deleted:** sync `resolve_auth`, its `oauth2_is_not_implemented` test.

- [ ] **Step 1: Write the failing tests**

```rust
use crate::auth::{OAuth2ClientCredentialsConfig, AuthCredentials, StaticTokenSource};

fn static_tokens(value: &str) -> StaticTokenSource {
    StaticTokenSource { header: AuthCredentials {
        header_name: "authorization".into(), header_value: value.into() } }
}

#[tokio::test]
async fn oauth_config_wins_and_is_materialized_via_token_source() {
    let mut coll = base_collection(&[("host", "h:1"), ("uid", "u")]);
    coll.auth = SavedAuthConfig::OAuth2ClientCredentials(OAuth2ClientCredentialsConfig {
        token_url: "https://idp/token".into(), client_id: "cid".into(),
        client_secret: "sec".into(), scopes: vec![],
        header_name: "authorization".into(), prefix: "Bearer ".into(), environments: vec![],
    });
    let active = env("prod", &[]);
    let req = base_request();
    let tokens = static_tokens("Bearer TOK");
    let eff = resolve_request(&req, Some(&coll), Some(&active), &tokens).await.unwrap();
    assert_eq!(eff.auth.unwrap().header_value, "Bearer TOK");
    assert!(eff.invalidate_oauth.is_some());
}

#[tokio::test]
async fn oauth_fields_resolve_against_vars_before_token_source() {
    // client_secret is a {{var}} — resolved in core, so the cache key uses the value.
    let mut coll = base_collection(&[("host", "h:1"), ("uid", "u"), ("sec", "S3CRET")]);
    coll.auth = SavedAuthConfig::OAuth2ClientCredentials(OAuth2ClientCredentialsConfig {
        token_url: "https://idp/token".into(), client_id: "cid".into(),
        client_secret: "{{sec}}".into(), scopes: vec![],
        header_name: "authorization".into(), prefix: "Bearer ".into(), environments: vec![],
    });
    let active = env("prod", &[]);
    let req = base_request();
    let tokens = static_tokens("Bearer TOK");
    let eff = resolve_request(&req, Some(&coll), Some(&active), &tokens).await.unwrap();
    assert_eq!(eff.invalidate_oauth.unwrap().client_secret, "S3CRET"); // resolved, not "{{sec}}"
}

#[tokio::test]
async fn unresolved_var_in_oauth_field_is_resolve_failure() {
    let mut coll = base_collection(&[("host", "h:1"), ("uid", "u")]);
    coll.auth = SavedAuthConfig::OAuth2ClientCredentials(OAuth2ClientCredentialsConfig {
        token_url: "{{missing_url}}".into(), client_id: "cid".into(),
        client_secret: "sec".into(), scopes: vec![],
        header_name: "authorization".into(), prefix: "Bearer ".into(), environments: vec![],
    });
    let active = env("prod", &[]);
    let req = base_request();
    let tokens = static_tokens("Bearer TOK");
    match resolve_request(&req, Some(&coll), Some(&active), &tokens).await.unwrap_err() {
        CoreError::ResolveFailed { unresolved, .. } => {
            assert!(unresolved.contains(&"missing_url".to_string()));
        }
        other => panic!("expected ResolveFailed, got {other:?}"),
    }
}
```

Update every existing `resolve_request(&req, Some(&coll), Some(&active))` call in the module to add `, &tokens` (use a `static_tokens("Bearer X")` local) and make each `#[test]` a `#[tokio::test] async`.

- [ ] **Step 2: Run — expect FAIL.**

Run: `cargo test -p handshaker-core --lib collections::resolve`
Expected: FAIL (async signature + `invalidate_oauth`).

- [ ] **Step 3: Implement**

`collections/mod.rs` — add to `EffectiveRequest`:

```rust
    /// The resolved OAuth2 config whose token materialized `auth`, if any. The Send
    /// command uses it to invalidate the token cache on a 16 UNAUTHENTICATED. `None`
    /// for None/EnvVar auth.
    pub invalidate_oauth: Option<crate::auth::OAuth2ClientCredentialsConfig>,
```

`auth/mod.rs` — delete the sync `resolve_auth` fn + its `none_resolves_to_no_credentials`, `env_var_reads_secret_and_applies_prefix` (move into new helper test), `oauth2_is_not_implemented` tests. Add:

```rust
/// Read the secret named by `cfg.env_var` from the OS env and build `prefix + secret`.
pub fn materialize_env_var(cfg: &EnvVarAuthConfig) -> Result<AuthCredentials, CoreError> {
    let secret = std::env::var(&cfg.env_var)
        .map_err(|_| CoreError::Auth(format!("env var `{}` not set", cfg.env_var)))?;
    Ok(AuthCredentials {
        header_name: cfg.header_name.clone(),
        header_value: format!("{}{}", cfg.prefix, secret),
    })
}
```
(Keep `env_var_missing_is_auth_error` retargeted to `materialize_env_var`.)

`collections/resolve.rs` — make `resolve_request` async, add `tokens: &dyn TokenSource`, and after the field-report gate, materialize auth. **Resolve oauth fields into the same accumulator BEFORE gating** so an unresolved oauth var is reported alongside body/metadata vars:

```rust
    // ... after acc.take(address/body/metadata) ...
    let collection_auth = collection.map(|c| &c.auth);
    let picked = pick_auth_config(&request.auth, collection_auth,
        active_env.map(|e| e.name.as_str())).cloned();

    // Resolve oauth {{var}} fields into the same report (so failures surface together).
    let resolved_oauth = match &picked {
        Some(SavedAuthConfig::OAuth2ClientCredentials(c)) => {
            Some(OAuth2ClientCredentialsConfig {
                token_url: acc.take(&c.token_url, &vars),
                client_id: acc.take(&c.client_id, &vars),
                client_secret: acc.take(&c.client_secret, &vars),
                scopes: c.scopes.iter().map(|s| acc.take(s, &vars)).collect(),
                header_name: c.header_name.clone(),
                prefix: c.prefix.clone(),
                environments: c.environments.clone(),
            })
        }
        _ => None,
    };
    if let Some(err) = acc.into_failure() {
        return Err(err); // no network/env side-effects on failure
    }

    let target = GrpcTarget::new(address, tls, skip_verify)?;

    let (auth, invalidate_oauth) = match picked {
        None => (None, None),
        Some(SavedAuthConfig::None) => (None, None), // unreachable via pick
        Some(SavedAuthConfig::EnvVar(c)) => (Some(materialize_env_var(&c)?), None),
        Some(SavedAuthConfig::OAuth2ClientCredentials(_)) => {
            let cfg = resolved_oauth.expect("oauth picked ⇒ resolved config present");
            let creds = tokens.header_for(&cfg).await?;
            (Some(creds), Some(cfg))
        }
    };

    Ok(EffectiveRequest { target, service: request.service.clone(),
        method: request.method.clone(), body_json, metadata, auth, invalidate_oauth })
```

Move the `address`/`body`/`metadata` `acc.take` calls before this block (they already are), and compute `tls`/`skip_verify` before `GrpcTarget::new`. Import `use crate::auth::{materialize_env_var, pick_auth_config, OAuth2ClientCredentialsConfig, SavedAuthConfig, TokenSource};`.

`src-tauri/src/commands/auth.rs` — `auth_resolve_impl`'s `other =>` arm called the deleted `resolve_auth`. Rewrite:

```rust
match config.into_core() {
    SavedAuthConfig::OAuth2ClientCredentials(c) => {
        let creds = self.oauth2_provider.header_for(&c).await?;
        Ok(Some(AuthCredentialsIpc::from_core(creds)))
    }
    SavedAuthConfig::None => Ok(None),
    SavedAuthConfig::EnvVar(c) =>
        Ok(Some(AuthCredentialsIpc::from_core(handshaker_core::auth::materialize_env_var(&c)?))),
}
```

- [ ] **Step 4: Run — expect PASS.**

Run: `cargo test -p handshaker-core --lib && cargo test -p handshaker commands::auth`
Expected: PASS.

- [ ] **Step 5: Run workspace gate**

Run: `cargo test --workspace`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add crates/handshaker-core src-tauri/src/commands/auth.rs
git commit -m "feat(core): async resolve_request materializes OAuth2 via TokenSource; drop NotImplemented stub"
```

**Slice 3 gate:** `cargo test --workspace` green.

---

# Slice 4 — auth_effective: UI asks the core for effective auth (Issue #4, blocked by #1)

Deliverable: an `auth_effective` command answers "which auth wins" via the core pick; the Auth tab and history snapshot consume it through a hook. The TS pick copy still exists (its Send role dies in Slice 5).

### Task 4.1: `SendCtxIpc` + `auth_effective` command

**Files:**
- Create/modify: `src-tauri/src/ipc/invoke.rs` (or new `src-tauri/src/ipc/send.rs`) for `SendCtxIpc`
- Modify: `src-tauri/src/commands/auth.rs`, `src-tauri/src/lib.rs` (register)
- Test: `commands/auth.rs` tests

**Interfaces:**
- Consumes: `pick_auth_config`, `collection_store`.
- Produces:
  - `SendCtxIpc { collection_id: Option<String>, env_name: Option<String> }` (Deserialize + Type)
  - `auth_effective(state, step_auth: SavedAuthConfigIpc, ctx: SendCtxIpc) -> Result<SavedAuthConfigIpc, IpcError>` — returns the winning config (or `SavedAuthConfigIpc::None`).

- [ ] **Step 1: Write the failing tests**

```rust
#[tokio::test]
async fn effective_prefers_request_auth() {
    let state = AppState::default();
    let step = SavedAuthConfigIpc::EnvVar {
        env_var: "R".into(), header_name: "authorization".into(),
        prefix: "Bearer ".into(), environments: vec![] };
    let out = state.auth_effective_impl(step, SendCtxIpc { collection_id: None, env_name: Some("prod".into()) }).await.unwrap();
    assert!(matches!(out, SavedAuthConfigIpc::EnvVar { env_var, .. } if env_var == "R"));
}

#[tokio::test]
async fn effective_falls_back_to_collection_auth() {
    let state = AppState::default();
    let cid = handshaker_core::collections::ids::CollectionId::new();
    state.collection_store.upsert(/* Collection with auth = EnvVar{env_var:"C",...}, id: cid */).unwrap();
    let out = state.auth_effective_impl(
        SavedAuthConfigIpc::None,
        SendCtxIpc { collection_id: Some(cid.0.to_string()), env_name: Some("prod".into()) },
    ).await.unwrap();
    assert!(matches!(out, SavedAuthConfigIpc::EnvVar { env_var, .. } if env_var == "C"));
}

#[tokio::test]
async fn effective_gates_scoped_collection_auth_out_of_env() {
    // collection auth scoped to ["prod"], active env "dev" ⇒ None.
    // (build like above with environments: vec!["prod".into()]) ...
    // assert matches!(out, SavedAuthConfigIpc::None)
}
```

- [ ] **Step 2: Run — expect FAIL.**

Run: `cargo test -p handshaker commands::auth::tests::effective`
Expected: FAIL.

- [ ] **Step 3: Implement**

`SendCtxIpc` (in `ipc/invoke.rs` or new `ipc/send.rs`, export from `ipc/mod.rs`):

```rust
#[derive(Debug, Clone, Deserialize, Type)]
pub struct SendCtxIpc {
    pub collection_id: Option<String>,
    pub env_name: Option<String>,
}
```

`commands/auth.rs`:

```rust
impl AppState {
    pub async fn auth_effective_impl(
        &self, step_auth: SavedAuthConfigIpc, ctx: SendCtxIpc,
    ) -> Result<SavedAuthConfigIpc, CoreError> {
        let collection_auth = ctx.collection_id.as_deref()
            .and_then(|id| crate::ipc::collection::parse_collection_id(id).ok())
            .and_then(|cid| self.collection_store.get(cid))
            .map(|c| c.auth);
        let req = step_auth.into_core();
        let picked = handshaker_core::auth::pick_auth_config(
            &req, collection_auth.as_ref(), ctx.env_name.as_deref());
        Ok(SavedAuthConfigIpc::from_core(picked.cloned().unwrap_or(SavedAuthConfig::None)))
    }
}

#[tauri::command]
#[specta::specta]
pub async fn auth_effective(
    state: State<'_, AppState>, step_auth: SavedAuthConfigIpc, ctx: SendCtxIpc,
) -> Result<SavedAuthConfigIpc, IpcError> {
    state.auth_effective_impl(step_auth, ctx).await.map_err(IpcError::from)
}
```

Register `auth_effective` in `collect_commands![...]` in `lib.rs`.

- [ ] **Step 4: Run — expect PASS.** Regenerate bindings.

Run: `cargo test -p handshaker commands::auth`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src-tauri src/ipc/bindings.ts
git commit -m "feat(ipc): auth_effective command answers the pick via core (send ctx)"
```

### Task 4.2: `useEffectiveAuth` hook + Auth tab consumes it

**Files:**
- Create: `src/features/workflow/useEffectiveAuth.ts` (+ test)
- Modify: `src/ipc/client.ts` (`authEffective`), `src/features/workflow/CallPanel.tsx`
- Test: `src/features/workflow/useEffectiveAuth.test.ts`

**Interfaces:**
- Consumes: `commands.authEffective` via `ipc.authEffective(stepAuth, ctx)`.
- Produces: `useEffectiveAuth(stepAuth, ctx: { collection_id: string | null; env_name: string | null }, revisionKey: string): SavedAuthConfigIpc` — re-fetches on `revisionKey` change; returns `{ kind: "none" }` until resolved.

- [ ] **Step 1: `authEffective` client wrapper**

`src/ipc/client.ts`:

```ts
export async function authEffective(
  stepAuth: SavedAuthConfigIpc,
  ctx: SendCtxIpc,
): Promise<SavedAuthConfigIpc> {
  const r = await commands.authEffective(stepAuth, ctx);
  if (r.status === "error") throw r.error;
  return r.data;
}
```
Add to the `ipc` object export. (Import `SendCtxIpc` from bindings.)

- [ ] **Step 2: Write the failing hook test**

```ts
// useEffectiveAuth.test.ts — mock ipc.authEffective; assert it resolves to the
// backend's config and re-fetches when revisionKey changes.
```

- [ ] **Step 3: Run — expect FAIL.**

Run: `pnpm test src/features/workflow/useEffectiveAuth`
Expected: FAIL.

- [ ] **Step 4: Implement the hook**

`useEffectiveAuth.ts` — `useEffect` keyed on `revisionKey` (+ `stepAuth` identity, `ctx.collection_id`, `ctx.env_name`) that calls `ipc.authEffective`, stores the result in state, guards against stale responses (ignore a settled fetch that isn't the latest). Default state `{ kind: "none" }`.

- [ ] **Step 5: Wire into CallPanel**

In `CallPanel.tsx`, replace the synchronous `const effectiveAuth = pickEffectiveAuth(step.auth, originAuth ?? null, activeWf.envName);` with:

```ts
const effectiveAuth = useEffectiveAuth(
  step.auth,
  { collection_id: step.collectionId ?? null, env_name: activeWf.envName },
  addressResolveKey, // already folds env name + revision + collection
);
```

`effectiveAuth` still feeds `RequestTabs serviceAuth={effectiveAuth}` and the history snapshot `buildExecutedStep({ ...step, auth: effectiveAuth }, patch)`. **Do not** yet remove `pickEffectiveAuth` from `actions.ts` — Slice 5 removes it (the Send path still calls it until then). Keep the `resolveAuthHeader` Send path unchanged in this slice.

- [ ] **Step 6: Run — expect PASS.**

Run: `pnpm test src/features/workflow && tsc -b`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/features/workflow/useEffectiveAuth.ts src/features/workflow/useEffectiveAuth.test.ts src/ipc/client.ts src/features/workflow/CallPanel.tsx
git commit -m "feat(workflow): Auth tab reads effective auth from core via useEffectiveAuth"
```

**Slice 4 gate:** `cargo test --workspace` · vitest · `tsc -b` · `vite build` · bindings no-drift.

---

# Slice 5 — grpc_send: live Send through the core pipeline (Issue #5, blocked by #2, #3)

The main tracer bullet. Deliverable: `grpc_send` replaces `grpc_invoke_oneshot`; the frontend Send shrinks to call+map; the TS resolve mirror is deleted; `skip_tls_verify` works on bound-draft Send.

### Task 5.1: `IpcError::UnresolvedVars`

**Files:**
- Modify: `src-tauri/src/ipc/error.rs`
- Test: same file

**Interfaces:**
- Produces: `IpcError::UnresolvedVars { unresolved: Vec<String>, cycle: Option<Vec<String>> }`; `CoreError::ResolveFailed` maps to it (replacing the Slice-1 temporary arm).

- [ ] **Step 1: Write the failing test**

```rust
#[test]
fn resolve_failed_maps_to_unresolved_vars() {
    let e: IpcError = CoreError::ResolveFailed {
        unresolved: vec!["a".into(), "b".into()], cycle: None }.into();
    match e {
        IpcError::UnresolvedVars { unresolved, cycle } => {
            assert_eq!(unresolved, vec!["a", "b"]);
            assert!(cycle.is_none());
        }
        other => panic!("got {other:?}"),
    }
}
```

- [ ] **Step 2: Run — expect FAIL.**

Run: `cargo test -p handshaker ipc::error::tests::resolve_failed_maps`
Expected: FAIL.

- [ ] **Step 3: Implement**

Add the variant to `IpcError`:

```rust
    UnresolvedVars { unresolved: Vec<String>, cycle: Option<Vec<String>> },
```

Replace the Slice-1 temporary `CoreError::ResolveFailed` arm with:

```rust
CoreError::ResolveFailed { unresolved, cycle } => IpcError::UnresolvedVars { unresolved, cycle },
```

- [ ] **Step 4: Run — expect PASS.** Regenerate bindings.

Run: `cargo test -p handshaker ipc::error`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/ipc/error.rs src/ipc/bindings.ts
git commit -m "feat(ipc): IpcError::UnresolvedVars carries the full resolve report"
```

### Task 5.2: `SendDraftIpc` + `grpc_send` command (replaces `grpc_invoke_oneshot`)

**Files:**
- Modify: `src-tauri/src/ipc/invoke.rs` (`SendDraftIpc`), `src-tauri/src/commands/grpc.rs` (`grpc_send`), `src-tauri/src/lib.rs` (register swap), `src-tauri/src/state.rs` (TokenSource access)
- Test: `commands/grpc.rs` tests (unit, no network — resolve-failure path + wiring)

**Interfaces:**
- Consumes: async `resolve_request`, `CallOptions`/`CallOptionsIpc`, `SendCtxIpc`, `expand_request_builtins`, `race_cancel_timeout`, `state.oauth2_provider` as `&dyn TokenSource`.
- Produces:
  - `SendDraftIpc { address_template, tls: bool, service, method, body_template, metadata: Vec<MetadataRowIpc>, auth: SavedAuthConfigIpc }`
  - `grpc_send(state, draft: SendDraftIpc, ctx: SendCtxIpc, request_id: String, opts: CallOptionsIpc) -> Result<InvokeOutcomeIpc, IpcError>`
  - **removed:** `grpc_invoke_oneshot`.

- [ ] **Step 1: Write the failing test (resolve-failure path, no network)**

```rust
#[tokio::test]
async fn grpc_send_unresolved_var_returns_unresolved_vars_error() {
    let state = AppState::default(); // empty stores ⇒ {{host}} unresolvable
    let draft = SendDraftIpc {
        address_template: "{{host}}".into(), tls: false,
        service: "pkg.Svc".into(), method: "Do".into(),
        body_template: "{}".into(), metadata: vec![],
        auth: SavedAuthConfigIpc::None,
    };
    let opts = CallOptionsIpc { timeout_ms: 1000, max_message_bytes: 0 };
    let err = grpc_send_impl(&state, draft, SendCtxIpc { collection_id: None, env_name: None },
        "rid".into(), opts).await.unwrap_err();
    match err {
        IpcError::UnresolvedVars { unresolved, .. } => assert_eq!(unresolved, vec!["host"]),
        other => panic!("got {other:?}"),
    }
}
```

(Extract the command body into a testable `grpc_send_impl(state: &AppState, …)` so the test needs no `State` wrapper — mirror the `*_impl` pattern used across the codebase.)

- [ ] **Step 2: Run — expect FAIL.**

Run: `cargo test -p handshaker commands::grpc::tests::grpc_send_unresolved`
Expected: FAIL.

- [ ] **Step 3: Implement `SendDraftIpc` + `grpc_send`**

`ipc/invoke.rs`:

```rust
#[derive(Debug, Deserialize, Type)]
pub struct SendDraftIpc {
    pub address_template: String,
    pub tls: bool,
    pub service: String,
    pub method: String,
    pub body_template: String,
    pub metadata: Vec<crate::ipc::collection::MetadataRowIpc>,
    pub auth: crate::ipc::collection::SavedAuthConfigIpc,
}
```

`commands/grpc.rs` — remove `grpc_invoke_oneshot`, add:

```rust
pub(crate) async fn grpc_send_impl(
    state: &AppState,
    draft: SendDraftIpc,
    ctx: SendCtxIpc,
    request_id: String,
    opts: CallOptionsIpc,
) -> Result<InvokeOutcomeIpc, IpcError> {
    // Read collection + active env from the stores (ctx carries references, not data).
    let collection = ctx.collection_id.as_deref()
        .and_then(|id| crate::ipc::collection::parse_collection_id(id).ok())
        .and_then(|cid| state.collection_store.get(cid));
    let active_env = ctx.env_name.as_deref().and_then(|n| state.env_store.get(n));

    // Build a SavedRequest view over the draft; the UI toggle is the tls override.
    let saved = SavedRequest {
        id: ItemId(Uuid::nil()), name: String::new(),
        address_template: draft.address_template,
        service: draft.service.clone(), method: draft.method.clone(),
        body_template: draft.body_template,
        metadata: draft.metadata.into_iter().map(|r| r.into_core()).collect(),
        auth: draft.auth.into_core(),
        tls_override: Some(draft.tls),
        last_used_at: None, use_count: 0,
    };

    let tokens: &dyn TokenSource = &state.oauth2_provider;
    let eff = resolve_request(&saved, collection.as_ref(), active_env.as_ref(), tokens)
        .await?; // CoreError::ResolveFailed ⇒ IpcError::UnresolvedVars via From

    // Assemble InvokeRequest: effective body + metadata + auth header.
    let mut metadata = eff.metadata;
    if let Some(creds) = &eff.auth {
        metadata.insert(creds.header_name.clone(), creds.header_value.clone());
    }
    let mut request = InvokeRequest {
        service: eff.service, method: eff.method,
        request_json: eff.body_json, metadata,
    };
    let invalidate = eff.invalidate_oauth;
    let timeout_ms = opts.timeout_ms;
    let call_opts = CallOptions { max_message_bytes: resolve_max_message_size(opts.max_message_bytes) };
    let target = eff.target;
    let cache = state.contract_cache.clone();

    let outcome = {
        let work = async move {
            expand_request_builtins(&mut request, &handshaker_core::vars::builtins::SystemBuiltins);
            let transport = Arc::new(TonicTransport::new());
            let conn = activate(target, transport, cache.as_ref()).await?;
            let outcome = invoke_unary(&conn, &request.service, &request.method,
                &request.request_json, request.metadata, call_opts).await?;
            Ok::<InvokeOutcomeIpc, IpcError>(outcome.into())
        };
        race_cancel_timeout(&state.in_flight, request_id, timeout_ms, work).await?
    };

    // On 16 UNAUTHENTICATED drop the cached oauth token; next Send fetches fresh. No retry.
    if outcome.status_code == 16 {
        if let Some(cfg) = invalidate {
            state.oauth2_provider.invalidate(&cfg);
        }
    }
    Ok(outcome)
}

#[tauri::command]
#[specta::specta]
pub async fn grpc_send(
    state: State<'_, AppState>,
    draft: SendDraftIpc,
    ctx: SendCtxIpc,
    request_id: String,
    opts: CallOptionsIpc,
) -> Result<InvokeOutcomeIpc, IpcError> {
    grpc_send_impl(&state, draft, ctx, request_id, opts).await
}
```

Add imports: `SavedRequest`, `ItemId`, `Uuid`, `resolve_request`, `CallOptions`, `TokenSource`, `SendCtxIpc`, `SendDraftIpc`. In `lib.rs` swap `grpc_invoke_oneshot` → `grpc_send` in `collect_commands![...]`.

> Note: `race_cancel_timeout` returning the outcome must happen before the 16-invalidation, but a cancel/timeout returns `Err` early (no invalidation) — matches today's no-retry design.

- [ ] **Step 4: Run — expect PASS.** Regenerate bindings.

Run: `cargo test -p handshaker commands::grpc`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src-tauri src/ipc/bindings.ts
git commit -m "feat(ipc): grpc_send replaces grpc_invoke_oneshot — resolve pipeline owns Send"
```

### Task 5.3: frontend Send shrinks to call+map; delete the TS resolve mirror

**Files:**
- Modify: `src/ipc/client.ts` (`grpcSend`, drop `grpcInvokeOneshot`), `src/features/workflow/actions.ts`, `src/features/workflow/CallPanel.tsx`
- Delete: `src/features/workflow/resolve.ts`, `src/features/workflow/resolve.test.ts`, `src/features/workflow/resolveAuthHeader.test.ts`
- Test: `src/features/workflow/actions.test.ts` (rewrite the Send tests around `grpcSend`)

**Interfaces:**
- Consumes: `commands.grpcSend`.
- Produces: `sendStep(draft, ctx, opts) -> SendResult` where the frontend passes the raw draft + ctx; auth is `draft.auth` (the core picks/materializes). `SendResult` keeps its existing shape (`ok | error | unresolved | cancelled`).

- [ ] **Step 1: `grpcSend` client wrapper**

`src/ipc/client.ts`:

```ts
export async function grpcSend(
  draft: SendDraftIpc,
  ctx: SendCtxIpc,
  requestId: string,
  opts: CallOptionsIpc,
): Promise<InvokeOutcomeIpc> {
  const r = await commands.grpcSend(draft, ctx, requestId, opts);
  if (r.status === "error") throw r.error;
  return r.data;
}
```
Remove `grpcInvokeOneshot` from the file and the `ipc` object; add `grpcSend`. (Import `SendDraftIpc`, `SendCtxIpc`, `CallOptionsIpc` from bindings.)

- [ ] **Step 2: Rewrite the failing `actions.test.ts` Send tests**

Point them at a mocked `ipc.grpcSend`; assert `sendStep` (a) forwards the draft templates + ctx unchanged, (b) maps an `UnresolvedVars` throw to `{ kind: "unresolved", unresolved, cycle }`, (c) maps a `Cancelled` throw to `{ kind: "cancelled" }`, (d) returns `{ kind: "ok", outcome }` on success. Delete assertions that referenced `resolveStepTemplates`/`resolveAuthHeader`/`pickEffectiveAuth`.

- [ ] **Step 3: Run — expect FAIL.**

Run: `pnpm test src/features/workflow/actions`
Expected: FAIL.

- [ ] **Step 4: Implement the shrunk `sendStep` + delete the mirror**

Rewrite `sendStep` in `actions.ts`:

```ts
export async function sendStep(
  step: {
    address: string; tls: boolean; service: string; method: string;
    requestJson: string; metadata: MetadataRow[];
    auth: SavedAuthConfigIpc; collectionId?: string | null;
  },
  ctx: { envName: string | null },
  opts?: { requestId?: string; timeoutMs?: number; maxMessageBytes?: number },
): Promise<SendResult> {
  const requestId = opts?.requestId ?? newId();
  const prefs = readPrefs();
  const draft: SendDraftIpc = {
    address_template: step.address, tls: step.tls,
    service: step.service, method: step.method,
    body_template: step.requestJson,
    metadata: step.metadata.filter((m) => m.enabled && m.key)
      .map((m) => ({ key: m.key, value: m.value, enabled: true })),
    auth: step.auth,
  };
  const sendCtx: SendCtxIpc = { collection_id: step.collectionId ?? null, env_name: ctx.envName };
  const callOpts: CallOptionsIpc = {
    timeout_ms: opts?.timeoutMs ?? prefs.requestTimeoutMs,
    max_message_bytes: opts?.maxMessageBytes ?? prefs.maxMessageBytes,
  };
  try {
    const outcome = await ipc.grpcSend(draft, sendCtx, requestId, callOpts);
    return { kind: "ok", outcome };
  } catch (e) {
    if (isCancelError(e)) return { kind: "cancelled" };
    if (isObj(e) && e.type === "UnresolvedVars") {
      return { kind: "unresolved", unresolved: e.unresolved as string[], cycle: (e.cycle as string[] | null) ?? null };
    }
    return { kind: "error", fault: faultFromUnknown(e) };
  }
}
```

Delete from `actions.ts`: `pickEffectiveAuth`, `resolveAuthHeader`, `resolveOauthConfig`, `authEnvironments`, `AuthDeps`, `AuthHeader`/`AuthHeaderResult` types (if unused elsewhere), and the `resolveStepTemplates` import. Delete files `resolve.ts`, `resolve.test.ts`, `resolveAuthHeader.test.ts`. Keep `resolveAddressSafe`, `varsCtxFor`, `varsResolverFor` (reflection/editors still use them). Add a small `isObj` helper or reuse `netDiagnostics`'.

`stepPatchFromSendResult` already handles `kind: "unresolved"` — no change.

- [ ] **Step 5: Simplify `CallPanel.onSend`**

Remove `resolveAuthHeader`/`authResolve`/`authInvalidate` usage from `CallPanel.tsx`. `onSend` becomes:

```ts
const onSend = async () => {
  if (step.status === "sending") return;
  const requestId = newId();
  onPatch({ status: "sending", error: null, requestId });
  const res = await sendStep(
    { ...step, auth: step.auth },
    { envName: activeWf.envName },
    { requestId },
  );
  const patch = { ...stepPatchFromSendResult(res), requestId: null };
  onPatch(patch);
  if (onExecuted && shouldRecordExecuted(res)) {
    onExecuted(buildExecutedStep({ ...step, auth: effectiveAuth }, patch));
  }
};
```

Drop the imports `authResolve`, `authInvalidate`, `resolveAuthHeader`, `pickEffectiveAuth`, `varsResolverFor` (if now unused in this file — reflection still uses it via `DraftAddressBar resolveAddress`, so keep that import if referenced). The 16-invalidation moved into `grpc_send`, so its frontend block is deleted. `effectiveAuth` (from `useEffectiveAuth`, Slice 4) still feeds the history snapshot + `RequestTabs`.

- [ ] **Step 6: Run — expect PASS.**

Run: `pnpm test src/features/workflow && tsc -b && vite build`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/ipc/client.ts src/features/workflow/actions.ts src/features/workflow/actions.test.ts src/features/workflow/CallPanel.tsx
git rm src/features/workflow/resolve.ts src/features/workflow/resolve.test.ts src/features/workflow/resolveAuthHeader.test.ts
git commit -m "feat(workflow): Send calls grpc_send; delete the TS resolve mirror"
```

### Task 5.4: `skip_tls_verify` on bound-draft Send (integration guard)

**Files:**
- Test: `crates/handshaker-core/src/collections/resolve.rs` (guards the target flag; the wire already carries it through `grpc_send` reading `collection.skip_tls_verify`)

- [ ] **Step 1: Write the test**

```rust
#[tokio::test]
async fn bound_draft_honors_collection_skip_tls_verify() {
    let mut coll = base_collection(&[("host", "h:1"), ("uid", "u")]);
    coll.default_tls = true;
    coll.skip_tls_verify = true;
    let active = env("prod", &[]);
    let req = base_request();
    let tokens = static_tokens("Bearer X");
    let eff = resolve_request(&req, Some(&coll), Some(&active), &tokens).await.unwrap();
    assert!(eff.target.tls);
    assert!(eff.target.skip_verify); // was hardcoded false on the old frontend Send path
}
```

(Use whatever accessor `GrpcTarget` exposes for the skip-verify flag.)

- [ ] **Step 2: Run — expect PASS** (already implemented in Slice 1/3; this is the regression guard tying the behavioral fix to a test).

Run: `cargo test -p handshaker-core --lib collections::resolve::bound_draft_honors`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add crates/handshaker-core/src/collections/resolve.rs
git commit -m "test(core): bound-draft Send honors collection.skip_tls_verify"
```

**Slice 5 gate:** `cargo test --workspace` (incl. crate `tests/`) · vitest · `tsc -b` · `vite build` · bindings no-drift. **Live gate (human, post-merge):** Send with env+collection vars; OIDC endpoint (token via core; 16 → invalidate → next Send fresh); self-signed server with the collection toggle on; unbound draft; unresolved `{{var}}` shows the full list.

---

# Slice 6 — reflection/schema honor skip_tls_verify (Issue #6, independent)

Deliverable: reflection, skeleton, and message-schema paths dial with the origin collection's `skip_tls_verify` (bound draft), so the contract loads from a self-signed server the same way Send does. Data-threading only — backend untouched (`GrpcTargetIpc` already carries `skip_verify`).

### Task 6.1: thread `skipVerify` through the safe builders + reflection + schema

**Files:**
- Modify: `src/features/workflow/actions.ts` (`CallTargetInit` + `buildRequestSkeletonSafe` + `fetchMessageSchemaSafe`), `src/features/workflow/useDraftReflection.ts`, `src/features/workflow/useMessageSchema.ts`, `src/features/workflow/CallPanel.tsx`, `src/features/workflow/FocusView.tsx`
- Test: `src/features/workflow/actions.test.ts` (skeleton/schema target carries skipVerify)

**Interfaces:**
- Produces: `CallTargetInit` gains `skipVerify?: boolean` (default `false`); reflection/schema targets set `skip_verify` from the origin collection.

- [ ] **Step 1: Write the failing test**

In `actions.test.ts`, assert `buildRequestSkeletonSafe({ address, tls, collectionId, skipVerify: true }, …)` calls `ipc.grpcBuildRequestSkeleton` with a target whose `skip_verify === true`; and `false`/unbound stays `false`. Same for `fetchMessageSchemaSafe`.

- [ ] **Step 2: Run — expect FAIL.**

Run: `pnpm test src/features/workflow/actions`
Expected: FAIL.

- [ ] **Step 3: Implement the threading**

`actions.ts` — add `skipVerify?: boolean` to `CallTargetInit`; in `buildRequestSkeletonSafe` and `fetchMessageSchemaSafe`, replace `skip_verify: false` with `skip_verify: target.skipVerify ?? false`.

`useDraftReflection.ts` — add a `skipVerify: boolean` param (default `false`); use it in the `target` (`skip_verify: skipVerify`) instead of the hardcoded `false`.

`useMessageSchema.ts` — thread `skipVerify` from its target into `fetchMessageSchemaSafe`.

`FocusView.tsx` — alongside `originAuth`/`originVars`, read `originSkipVerify = origin ? tree.find(c => c.id === origin.collectionId)?.skip_tls_verify : undefined` and pass it into `CallPanel` as a prop `originSkipVerify`.

`CallPanel.tsx` — accept `originSkipVerify?: boolean`; pass `skipVerify: originSkipVerify ?? false` into the reflection call, `schemaTarget`, and the `onResetBody`/`buildRequestSkeletonSafe` target. Unbound draft (`origin` undefined) ⇒ `false`.

- [ ] **Step 4: Run — expect PASS.**

Run: `pnpm test src/features/workflow && tsc -b && vite build`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/workflow
git commit -m "feat(workflow): reflection/skeleton/schema honor collection skip_tls_verify"
```

**Slice 6 gate:** vitest · `tsc -b` · `vite build`. **Live gate (human):** contract/skeleton/schema load from a self-signed server when the collection toggle is on; unbound + toggle-off unchanged.

---

# Finalization (after all slices merged to `main`)

- [ ] Run the full whole-feature gate one more time on the integrated result: `cargo test --workspace` (incl. `crates/handshaker-core/tests/`) · `pnpm test` · `tsc -b` · `vite build` · bindings no-drift (second regen produces no diff).
- [ ] `git mv` the plan + spec into `archive/` (rule `.claude/rules/archiving-completed-work.md`): `docs/superpowers/plans/2026-07-02-single-resolve-pipeline.md` → `plans/archive/`, `docs/superpowers/specs/2026-07-02-single-resolve-pipeline-design.md` → `specs/archive/`, single commit `docs(archive): single resolve pipeline plan+spec`.
- [ ] Update `CLAUDE.md` «Active work»: make this the new «Последняя влитая», demote the prior one; mark the plan/spec status banners DONE with commit + gate numbers.
- [ ] Close issues #1–#6 with a note pointing at the merge commits.
- [ ] Live WebView2 pass (human gate): the Slice-5 and Slice-6 live checklists above.

---

## Self-Review

**Spec coverage:**
- Async `resolve_request` + `Option<&Collection>` + `TokenSource` → Slices 1, 3. ✓
- pick/materialize split → Task 1.1 (pick), Task 3.2 (materialize). ✓
- Full `ResolveFailure` report → Task 1.2. ✓
- `NotImplemented` stub dies → Task 3.2. ✓
- `CallOptions` → Slice 2. ✓
- `grpc_send` replace-in-place → Task 5.2. ✓
- `IpcError::UnresolvedVars` → Task 5.1. ✓
- `auth_effective` + hook → Slice 4. ✓
- Delete TS mirror → Task 5.3. ✓
- `skip_tls_verify` on Send → Task 5.4; on reflection → Slice 6. ✓
- Builtins stay literal → Task 1.2 test. ✓

**Type consistency:** `CallOptions { max_message_bytes }` (core) vs `CallOptionsIpc { timeout_ms, max_message_bytes }` (wire) used consistently in Slices 2/5. `SendCtxIpc { collection_id, env_name }` shared by Slices 4/5. `EffectiveRequest.invalidate_oauth` produced in 3.2, consumed in 5.2. `resolve_request` async-with-tokens signature identical in 3.2 and 5.2. `pick_auth_config` signature identical in 1.1, 3.2, 4.1.

**Resolved (verified against the tree):** tauri crate package name is `handshaker` (`cargo test -p handshaker …`); `GrpcTarget.skip_verify` is a public field (`eff.target.skip_verify` in assertions is valid); `MetadataRowIpc::into_core() -> MetadataRow` already exists (`src-tauri/src/ipc/collection.rs`), so the `SendDraftIpc` metadata assembly in Task 5.2 compiles as written.
