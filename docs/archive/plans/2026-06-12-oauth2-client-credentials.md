# OAuth2 client-credentials per-collection auth — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Status:** 🎉 DONE — all 12 tasks implemented, reviewed (spec+quality per task +
final branch review), and green on `claude/loving-spence-d73a28` (commits
`30311d4`…`436e447`). Gate: core 180 + lib 49 Rust tests, 789 vitest, tsc clean,
bindings no-drift, `pnpm build` ok. Remaining: ff-merge to `main` + a live WebView2
pass against a real OIDC endpoint (manual). · spec
`docs/superpowers/specs/2026-06-12-oauth2-client-credentials-design.md`

> **As-built correction (dependency):** Task 4 below literally specifies reqwest's
> `rustls-no-provider` feature + a manual `rustls`/ring install. That feature is only on
> reqwest's master, NOT published 0.12.x. The build instead uses
> `reqwest = { default-features = false, features = ["rustls-tls"] }`, which (via feature
> unification with tonic's `tls-ring`) resolves to **ring with NO aws-lc-rs** — verified
> in `Cargo.lock`. The app installs the ring crypto provider at startup (`lib.rs::run`)
> before the provider is constructed, so no manual install in `Oauth2TokenProvider::new`
> is needed. Net goal (rustls+ring, no aws-lc-rs, no OpenSSL) is met. Also: the IPC
> `OAuth2TokenInfoIpc.expires_in_secs` is `u32` (not `u64`) because specta rejects `u64`.

**Goal:** Implement the deferred `SavedAuthConfig::OAuth2ClientCredentials` — fetch a
Bearer token from an OIDC `client_credentials` endpoint, cache it per-collection
in the Rust backend with lazy refresh on expiry, gate auth by active environment,
and make it editable in the collection Auth tab with a "Get token" test button.

**Architecture:** Core owns the logic (`auth/oauth2.rs`: pure token-response
parsing + a pure `TokenCache` + an async `Oauth2TokenProvider` over `reqwest`/rustls);
`src-tauri` holds the provider in managed state and exposes thin IPC; the frontend
resolves `{{var}}` templates before the IPC call, gates by active env, and invalidates
the cache on a gRPC `UNAUTHENTICATED` (16) status. No auto-retry, no background refresh,
no disk persistence of tokens.

**Tech Stack:** Rust (handshaker-core, src-tauri/Tauri 2, reqwest+rustls-ring,
wiremock for tests) · React 18 + TypeScript (Monaco editors, shadcn UI) · vitest.

---

## Prerequisites (read once)

- **Fresh worktree:** run `pnpm install`, then `pnpm build` (produces `dist/`) **before**
  any `cargo` command in `src-tauri` — `tauri_build`/`generate_context!` requires `dist/`.
  Core (`handshaker-core`) compiles without `dist/`.
- **Where the live send path resolves auth:** `CallPanel.onSend`
  (`src/features/workflow/CallPanel.tsx:47`) → `resolveAuthHeader` → IPC `auth_resolve`.
  The core `resolve_request`/`resolve_auth_chain` path is updated for completeness
  (env-gate) but is not on the live send path.
- **Serde/specta tag trap:** the existing oauth2 IPC variant currently generates the TS
  literal `oauth_2_client_credentials` while serde's `rename_all="snake_case"` would emit
  `oauth2_client_credentials` at runtime. Because oauth2 has never round-tripped through
  the UI, this latent mismatch was harmless. This plan makes oauth2 first-class, so
  Task 1 / Task 6 **pin the tag explicitly** with `#[serde(rename = "oauth2_client_credentials")]`
  on the variant in both the core and IPC enums and assert it with a serialization test.

## File Structure

**Core (`crates/handshaker-core`)**
- `src/auth/mod.rs` — *modify*: rename `client_secret_env_var → client_secret`; add
  `header_name`/`prefix`/`environments` to `OAuth2ClientCredentialsConfig`; add
  `environments` to `EnvVarAuthConfig`; pin the enum variant tag; add
  `auth_active_for_env`; `pub mod oauth2;`.
- `src/auth/oauth2.rs` — *create*: `TokenResponse` + `parse_token_response` +
  `token_request_form` (pure); `CacheKey`/`CachedToken`/`TokenCache` (pure);
  `Oauth2TokenProvider` (async, reqwest); wiremock integration test.
- `src/collections/resolve.rs` — *modify*: thread active-env name into
  `resolve_auth_chain`; env-gate each candidate.
- `Cargo.toml` + workspace `Cargo.toml` — *modify*: add `reqwest`, `rustls`, `wiremock`.

**IPC (`src-tauri`)**
- `src/ipc/collection.rs` — *modify*: update `SavedAuthConfigIpc` (fields + tag) and
  `from_core`/`into_core`.
- `src/ipc/auth.rs` — *modify*: add `OAuth2TokenInfoIpc`.
- `src/state.rs` — *modify*: add `oauth2_provider: Oauth2TokenProvider` to `AppState`.
- `src/commands/auth.rs` — *modify*: `auth_resolve` dispatches oauth2 → provider; add
  `auth_oauth2_fetch_token`, `auth_invalidate` (logic on `AppState` impls).
- `src/lib.rs` — *modify*: register the two new commands.

**Frontend (`src`)**
- `src/features/catalog/overview/authConfigMap.ts` — *modify*: full oauth2 + env-scope mapping.
- `src/features/catalog/overview/SavedAuthEditor.tsx` — *modify*: oauth2 form, "Get token",
  "Apply in environments" popover.
- `src/features/workflow/actions.ts` — *modify*: `resolveAuthHeader` env-gate + var
  resolution; export `resolveOauthConfig`; extend `AuthHeaderResult`.
- `src/features/workflow/CallPanel.tsx` — *modify*: pass active env + `varsResolve`;
  invalidate on status 16.
- `src/ipc/client.ts` — *modify*: add `authOauth2FetchToken`, `authInvalidate` wrappers.
- `src/ipc/bindings.ts` — *regenerated* (Task 8), never hand-edited.

---

# Phase 1 — Core model

### Task 1: Model fields, tag pin, and env helper

**Files:**
- Modify: `crates/handshaker-core/src/auth/mod.rs`
- Test: same file (`#[cfg(test)] mod tests`)

- [ ] **Step 1: Write failing tests** — append to the `tests` module in
  `crates/handshaker-core/src/auth/mod.rs`:

```rust
    #[test]
    fn oauth2_config_defaults_fill_header_prefix_and_envs() {
        // A pre-existing JSON without the new fields must still deserialize.
        let json = r#"{"kind":"oauth2_client_credentials","token_url":"u","client_id":"c","client_secret":"s","scopes":[]}"#;
        let cfg: SavedAuthConfig = serde_json::from_str(json).unwrap();
        match cfg {
            SavedAuthConfig::OAuth2ClientCredentials(c) => {
                assert_eq!(c.header_name, "authorization");
                assert_eq!(c.prefix, "Bearer ");
                assert!(c.environments.is_empty());
                assert_eq!(c.client_secret, "s");
            }
            other => panic!("expected oauth2, got {other:?}"),
        }
    }

    #[test]
    fn oauth2_variant_tag_is_pinned() {
        let cfg = SavedAuthConfig::OAuth2ClientCredentials(OAuth2ClientCredentialsConfig {
            token_url: "u".into(), client_id: "c".into(), client_secret: "s".into(),
            scopes: vec![], header_name: "authorization".into(), prefix: "Bearer ".into(),
            environments: vec![],
        });
        let json = serde_json::to_string(&cfg).unwrap();
        assert!(json.contains(r#""kind":"oauth2_client_credentials""#), "got {json}");
    }

    #[test]
    fn env_var_config_environments_default_empty() {
        let json = r#"{"kind":"env_var","env_var":"V","header_name":"authorization","prefix":"Bearer "}"#;
        let cfg: SavedAuthConfig = serde_json::from_str(json).unwrap();
        match cfg {
            SavedAuthConfig::EnvVar(c) => assert!(c.environments.is_empty()),
            other => panic!("expected env_var, got {other:?}"),
        }
    }

    #[test]
    fn auth_active_for_env_rules() {
        // empty list ⇒ always active
        assert!(auth_active_for_env(&[], None));
        assert!(auth_active_for_env(&[], Some("prod")));
        // scoped ⇒ active only when the active env is listed
        let prod = vec!["prod".to_string()];
        assert!(auth_active_for_env(&prod, Some("prod")));
        assert!(!auth_active_for_env(&prod, Some("dev")));
        assert!(!auth_active_for_env(&prod, None)); // "No environment"
    }
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cargo test -p handshaker-core auth::tests`
Expected: FAIL to compile (`client_secret`, `header_name`, `environments`,
`auth_active_for_env` do not exist).

- [ ] **Step 3: Edit the model.** In `crates/handshaker-core/src/auth/mod.rs`:

Add the default helpers above the structs:

```rust
fn default_auth_header_name() -> String {
    "authorization".to_string()
}
fn default_auth_prefix() -> String {
    "Bearer ".to_string()
}
```

Replace `EnvVarAuthConfig` with (adds `environments`):

```rust
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct EnvVarAuthConfig {
    pub env_var: String,
    pub header_name: String,
    pub prefix: String,
    /// Environments this config applies to. Empty ⇒ all (see `auth_active_for_env`).
    #[serde(default)]
    pub environments: Vec<String>,
}
```

Replace `OAuth2ClientCredentialsConfig` with:

```rust
/// OAuth2 client-credentials config. All string fields are `{{var}}` templates,
/// resolved on the frontend before reaching the token provider.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct OAuth2ClientCredentialsConfig {
    pub token_url: String,
    pub client_id: String,
    /// The client secret value (a `{{var}}` template), NOT an env-var name.
    pub client_secret: String,
    pub scopes: Vec<String>,
    /// Header to set on the request (default `authorization`).
    #[serde(default = "default_auth_header_name")]
    pub header_name: String,
    /// Prefix prepended to the access token (default `Bearer `).
    #[serde(default = "default_auth_prefix")]
    pub prefix: String,
    /// Environments this config applies to. Empty ⇒ all.
    #[serde(default)]
    pub environments: Vec<String>,
}
```

Pin the variant tag — in the `SavedAuthConfig` enum, change the variant line to:

```rust
    #[serde(rename = "oauth2_client_credentials")]
    OAuth2ClientCredentials(OAuth2ClientCredentialsConfig),
```

Update `resolve_auth`'s oauth2 arm comment to note the live path uses the async
provider (logic unchanged — still `NotImplemented` in this sync function):

```rust
        SavedAuthConfig::OAuth2ClientCredentials(_) => {
            // Sync resolution is not supported; the live path goes through
            // `auth::oauth2::Oauth2TokenProvider` (async) via the IPC command.
            Err(CoreError::NotImplemented("oauth2 token fetch".into()))
        }
```

Add the env helper and the module declaration near the top of the file (after imports):

```rust
pub mod oauth2;

/// Whether an auth config scoped to `environments` is active under `active_env`.
/// Empty list ⇒ always active. Otherwise the active env name must be listed
/// ("No environment" ⇒ `None` ⇒ not listed ⇒ inactive).
pub fn auth_active_for_env(environments: &[String], active_env: Option<&str>) -> bool {
    environments.is_empty() || active_env.is_some_and(|e| environments.iter().any(|x| x == e))
}
```

Create an empty module file so the crate compiles (filled in Task 2):
`crates/handshaker-core/src/auth/oauth2.rs` with a single line:

```rust
//! OAuth2 client-credentials token fetch + cache (filled in Task 2).
```

The pre-existing `oauth2_is_not_implemented` test in this module constructs the
variant with `client_secret_env_var` — update its field to `client_secret` and add
the three new fields:

```rust
    #[test]
    fn oauth2_is_not_implemented() {
        let cfg = SavedAuthConfig::OAuth2ClientCredentials(OAuth2ClientCredentialsConfig {
            token_url: "https://idp/token".into(),
            client_id: "cid".into(),
            client_secret: "SECRET".into(),
            scopes: vec![],
            header_name: "authorization".into(),
            prefix: "Bearer ".into(),
            environments: vec![],
        });
        assert!(matches!(resolve_auth(&cfg).unwrap_err(), CoreError::NotImplemented(_)));
    }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cargo test -p handshaker-core auth`
Expected: PASS (all auth tests, including the new four).

- [ ] **Step 5: Commit**

```bash
git add crates/handshaker-core/src/auth/mod.rs crates/handshaker-core/src/auth/oauth2.rs
git commit -m "feat(core): oauth2 config fields (client_secret, header/prefix, environments) + env helper"
```

---

# Phase 2 — Core oauth2 module

### Task 2: Token-response parsing + form body (pure)

**Files:**
- Modify: `crates/handshaker-core/src/auth/oauth2.rs`
- Test: same file

- [ ] **Step 1: Write failing tests** — set the file content to (tests first; the
  `use` line references items added in Step 3):

```rust
//! OAuth2 client-credentials token fetch + cache.

use std::collections::HashMap;
use std::time::{Duration, Instant};

use serde::Deserialize;

use crate::auth::{AuthCredentials, OAuth2ClientCredentialsConfig};
use crate::error::CoreError;

#[cfg(test)]
mod tests {
    use super::*;

    fn cfg() -> OAuth2ClientCredentialsConfig {
        OAuth2ClientCredentialsConfig {
            token_url: "https://idp/token".into(),
            client_id: "cid".into(),
            client_secret: "sec".into(),
            scopes: vec!["a".into(), "b".into()],
            header_name: "authorization".into(),
            prefix: "Bearer ".into(),
            environments: vec![],
        }
    }

    #[test]
    fn form_body_has_grant_and_space_joined_scope() {
        let form = token_request_form(&cfg());
        assert!(form.contains(&("grant_type", "client_credentials".to_string())));
        assert!(form.contains(&("client_id", "cid".to_string())));
        assert!(form.contains(&("client_secret", "sec".to_string())));
        assert!(form.contains(&("scope", "a b".to_string())));
    }

    #[test]
    fn form_body_omits_scope_when_empty() {
        let mut c = cfg();
        c.scopes.clear();
        let form = token_request_form(&c);
        assert!(!form.iter().any(|(k, _)| *k == "scope"));
    }

    #[test]
    fn parse_ok_reads_token_and_expiry() {
        let body = r#"{"access_token":"tok","expires_in":1800,"token_type":"Bearer"}"#;
        let r = parse_token_response(200, body).unwrap();
        assert_eq!(r.access_token, "tok");
        assert_eq!(r.expires_in_secs, 1800);
    }

    #[test]
    fn parse_ok_defaults_missing_expiry_to_300() {
        let r = parse_token_response(200, r#"{"access_token":"tok"}"#).unwrap();
        assert_eq!(r.expires_in_secs, 300);
    }

    #[test]
    fn parse_ok_ignores_token_type() {
        // token_type other than Bearer is accepted (prefix is user-configured).
        let r = parse_token_response(200, r#"{"access_token":"tok","token_type":"mac"}"#).unwrap();
        assert_eq!(r.access_token, "tok");
    }

    #[test]
    fn parse_missing_access_token_is_auth_error() {
        let err = parse_token_response(200, r#"{"expires_in":60}"#).unwrap_err();
        assert!(matches!(err, CoreError::Auth(_)));
    }

    #[test]
    fn parse_error_status_surfaces_idp_error_fields() {
        let body = r#"{"error":"invalid_client","error_description":"bad secret"}"#;
        let err = parse_token_response(401, body).unwrap_err();
        match err {
            CoreError::Auth(m) => {
                assert!(m.contains("invalid_client"));
                assert!(m.contains("bad secret"));
                assert!(m.contains("401"));
            }
            other => panic!("expected Auth, got {other:?}"),
        }
    }
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cargo test -p handshaker-core auth::oauth2`
Expected: FAIL to compile (`token_request_form`, `parse_token_response`,
`TokenResponse` undefined).

- [ ] **Step 3: Implement (insert above the `#[cfg(test)]` block)**

```rust
const DEFAULT_EXPIRES_IN_SECS: u64 = 300;

/// Parsed, validated token-endpoint response.
pub struct TokenResponse {
    pub access_token: String,
    pub expires_in_secs: u64,
}

#[derive(Deserialize)]
struct RawTokenResponse {
    access_token: Option<String>,
    expires_in: Option<u64>,
}

#[derive(Deserialize)]
struct RawTokenError {
    error: Option<String>,
    error_description: Option<String>,
}

/// `application/x-www-form-urlencoded` pairs for a client-credentials request.
/// `scope` (space-joined) is omitted when there are no scopes.
fn token_request_form(cfg: &OAuth2ClientCredentialsConfig) -> Vec<(&'static str, String)> {
    let mut form = vec![
        ("grant_type", "client_credentials".to_string()),
        ("client_id", cfg.client_id.clone()),
        ("client_secret", cfg.client_secret.clone()),
    ];
    if !cfg.scopes.is_empty() {
        form.push(("scope", cfg.scopes.join(" ")));
    }
    form
}

/// Parse a token-endpoint response. Non-2xx → `Auth` with the IdP `error`/`error_description`
/// when present; 2xx without `access_token` → `Auth`; missing `expires_in` → 300s.
/// `token_type` is ignored (the header prefix is user-configured).
fn parse_token_response(status: u16, body: &str) -> Result<TokenResponse, CoreError> {
    if !(200..300).contains(&status) {
        let detail = serde_json::from_str::<RawTokenError>(body)
            .ok()
            .and_then(|e| {
                let code = e.error?;
                Some(match e.error_description {
                    Some(d) => format!("{code}: {d}"),
                    None => code,
                })
            })
            .unwrap_or_else(|| format!("HTTP {status}"));
        return Err(CoreError::Auth(format!(
            "oauth2 token request failed ({status}): {detail}"
        )));
    }
    let raw: RawTokenResponse = serde_json::from_str(body)
        .map_err(|e| CoreError::Auth(format!("oauth2 token response parse error: {e}")))?;
    let access_token = raw
        .access_token
        .ok_or_else(|| CoreError::Auth("oauth2 token response missing access_token".into()))?;
    Ok(TokenResponse {
        access_token,
        expires_in_secs: raw.expires_in.unwrap_or(DEFAULT_EXPIRES_IN_SECS),
    })
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cargo test -p handshaker-core auth::oauth2`
Expected: PASS (7 tests). `Duration`/`Instant`/`HashMap`/`AuthCredentials` imports are
unused for now — that's expected; they're consumed in Tasks 3–4. If the unused-import
warning blocks a `-D warnings` build, leave them; Task 3 lands in the same phase before
any lint gate.

- [ ] **Step 5: Commit**

```bash
git add crates/handshaker-core/src/auth/oauth2.rs
git commit -m "feat(core): oauth2 token-response parsing + form body"
```

### Task 3: Token cache (pure, time-injected)

**Files:**
- Modify: `crates/handshaker-core/src/auth/oauth2.rs`
- Test: same file

- [ ] **Step 1: Write failing tests** — add to the `tests` module:

```rust
    fn key(secret: &str) -> CacheKey {
        let mut c = cfg();
        c.client_secret = secret.into();
        CacheKey::from(&c)
    }

    #[test]
    fn fresh_token_is_returned_when_far_from_expiry() {
        let mut cache = TokenCache::new();
        let base = Instant::now();
        cache.put(key("s"), CachedToken { access_token: "tok".into(), expires_at: base + Duration::from_secs(100) });
        // 100s out, well beyond the 30s skew.
        assert_eq!(cache.get_fresh(&key("s"), base).map(|t| t.access_token.as_str()), Some("tok"));
    }

    #[test]
    fn token_within_skew_is_treated_as_stale() {
        let mut cache = TokenCache::new();
        let base = Instant::now();
        cache.put(key("s"), CachedToken { access_token: "tok".into(), expires_at: base + Duration::from_secs(100) });
        // now = base + 80s ⇒ 20s remaining ⇒ < 30s skew ⇒ stale.
        assert!(cache.get_fresh(&key("s"), base + Duration::from_secs(80)).is_none());
    }

    #[test]
    fn cache_key_ignores_header_and_prefix() {
        let mut a = cfg();
        a.header_name = "x-auth".into();
        a.prefix = "".into();
        let mut b = cfg(); // default header/prefix, same url/id/secret/scopes
        assert_eq!(CacheKey::from(&a), CacheKey::from(&b));
        // ...but secret/url/scope DO change the key:
        b.client_secret = "other".into();
        assert_ne!(CacheKey::from(&a), CacheKey::from(&b));
    }

    #[test]
    fn invalidate_removes_entry() {
        let mut cache = TokenCache::new();
        let base = Instant::now();
        cache.put(key("s"), CachedToken { access_token: "tok".into(), expires_at: base + Duration::from_secs(100) });
        cache.invalidate(&key("s"));
        assert!(cache.get_fresh(&key("s"), base).is_none());
    }
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cargo test -p handshaker-core auth::oauth2`
Expected: FAIL to compile (`CacheKey`, `CachedToken`, `TokenCache` undefined).

- [ ] **Step 3: Implement (insert above the `#[cfg(test)]` block)**

```rust
/// Skew subtracted from expiry — a token within this window of expiring is refetched.
const EXPIRY_SKEW: Duration = Duration::from_secs(30);

/// Cache identity = the resolved credentials that determine which token you get.
/// `header_name`/`prefix` are deliberately excluded (they shape the header, not the token).
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct CacheKey {
    token_url: String,
    client_id: String,
    client_secret: String,
    scopes: Vec<String>,
}

impl From<&OAuth2ClientCredentialsConfig> for CacheKey {
    fn from(c: &OAuth2ClientCredentialsConfig) -> Self {
        Self {
            token_url: c.token_url.clone(),
            client_id: c.client_id.clone(),
            client_secret: c.client_secret.clone(),
            scopes: c.scopes.clone(),
        }
    }
}

pub struct CachedToken {
    pub access_token: String,
    pub expires_at: Instant,
}

/// In-memory token store. Pure: callers inject `now`; no wall clock here.
#[derive(Default)]
pub struct TokenCache {
    entries: HashMap<CacheKey, CachedToken>,
}

impl TokenCache {
    pub fn new() -> Self {
        Self::default()
    }

    /// The cached token for `key`, but only if it stays valid for more than the skew.
    pub fn get_fresh(&self, key: &CacheKey, now: Instant) -> Option<&CachedToken> {
        self.entries
            .get(key)
            .filter(|t| t.expires_at.saturating_duration_since(now) > EXPIRY_SKEW)
    }

    pub fn put(&mut self, key: CacheKey, token: CachedToken) {
        self.entries.insert(key, token);
    }

    pub fn invalidate(&mut self, key: &CacheKey) {
        self.entries.remove(key);
    }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cargo test -p handshaker-core auth::oauth2`
Expected: PASS (11 tests).

- [ ] **Step 5: Commit**

```bash
git add crates/handshaker-core/src/auth/oauth2.rs
git commit -m "feat(core): oauth2 token cache with skew + config-derived key"
```

### Task 4: Async provider + reqwest dependency

**Files:**
- Modify: `Cargo.toml` (workspace), `crates/handshaker-core/Cargo.toml`,
  `crates/handshaker-core/src/auth/oauth2.rs`

- [ ] **Step 1: Add dependencies.** In the workspace `Cargo.toml`
  `[workspace.dependencies]` add:

```toml
# OAuth2 token fetch — rustls WITHOUT a bundled crypto provider (avoids aws-lc-rs /
# NASM+clang on Windows). The `ring` provider is installed at runtime (already done in
# lib.rs::run; the token provider also installs it best-effort for tests).
reqwest = { version = "0.12", default-features = false, features = ["rustls-no-provider"] }
rustls = { version = "0.23", default-features = false, features = ["ring"] }
wiremock = "0.6"
```

In `crates/handshaker-core/Cargo.toml` add under `[dependencies]`:

```toml
# OAuth2 client-credentials token fetch
reqwest.workspace = true
rustls.workspace = true
```

and under `[dev-dependencies]`:

```toml
wiremock.workspace = true
```

- [ ] **Step 2: Write a failing test** — add to the `tests` module in `oauth2.rs`
  (it drives the provider's header-building path without a network call by pre-seeding
  the cache; the network path is covered by Task 5's wiremock test):

```rust
    #[tokio::test]
    async fn header_for_uses_cached_token_and_applies_prefix() {
        let provider = Oauth2TokenProvider::new();
        let mut c = cfg();
        c.header_name = "authorization".into();
        c.prefix = "Bearer ".into();
        // Seed a fresh token directly so no network call happens.
        provider.seed_for_test(&c, "abc", Duration::from_secs(600));
        let creds = provider.header_for(&c).await.unwrap();
        assert_eq!(creds.header_name, "authorization");
        assert_eq!(creds.header_value, "Bearer abc");
    }

    #[tokio::test]
    async fn invalidate_drops_cached_token() {
        let provider = Oauth2TokenProvider::new();
        let c = cfg();
        provider.seed_for_test(&c, "abc", Duration::from_secs(600));
        provider.invalidate(&c);
        // After invalidation the cache miss would attempt a network fetch; assert the
        // entry is gone via the test accessor instead of triggering I/O.
        assert!(!provider.has_cached_for_test(&c));
    }
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cargo test -p handshaker-core auth::oauth2`
Expected: FAIL to compile (`Oauth2TokenProvider` undefined).

- [ ] **Step 4: Implement (insert above the `#[cfg(test)]` block).** Add imports at the
  top of the file (next to the existing `use`s):

```rust
use std::sync::Mutex;
```

Then the provider:

```rust
/// Builds the resolved header for a config + access token.
fn build_header(cfg: &OAuth2ClientCredentialsConfig, access_token: &str) -> AuthCredentials {
    AuthCredentials {
        header_name: cfg.header_name.clone(),
        header_value: format!("{}{}", cfg.prefix, access_token),
    }
}

async fn fetch_token(
    client: &reqwest::Client,
    cfg: &OAuth2ClientCredentialsConfig,
) -> Result<TokenResponse, CoreError> {
    let resp = client
        .post(&cfg.token_url)
        .form(&token_request_form(cfg))
        .send()
        .await
        .map_err(|e| CoreError::Auth(format!("oauth2 token request transport error: {e}")))?;
    let status = resp.status().as_u16();
    let body = resp
        .text()
        .await
        .map_err(|e| CoreError::Auth(format!("oauth2 token response read error: {e}")))?;
    parse_token_response(status, &body)
}

/// Session-lived token cache + HTTP client. Single-user desktop: no concurrent-fetch
/// dedup (YAGNI). The `std::Mutex` is never held across an `.await`.
pub struct Oauth2TokenProvider {
    cache: Mutex<TokenCache>,
    client: reqwest::Client,
}

impl Oauth2TokenProvider {
    pub fn new() -> Self {
        // `rustls-no-provider`: a crypto provider must be installed before the first
        // Client build. Idempotent — Err means one is already installed (the app does
        // this in lib.rs::run; tests rely on this call).
        let _ = rustls::crypto::ring::default_provider().install_default();
        let client = reqwest::Client::builder()
            .use_rustls_tls()
            .build()
            .expect("build reqwest client");
        Self { cache: Mutex::new(TokenCache::new()), client }
    }

    /// Cached fresh token, or a fresh fetch that is then cached. Builds the header
    /// from the (possibly custom) `header_name`/`prefix`.
    pub async fn header_for(
        &self,
        cfg: &OAuth2ClientCredentialsConfig,
    ) -> Result<AuthCredentials, CoreError> {
        let key = CacheKey::from(cfg);
        {
            let cache = self.cache.lock().expect("token cache poisoned");
            if let Some(tok) = cache.get_fresh(&key, Instant::now()) {
                return Ok(build_header(cfg, &tok.access_token));
            }
        }
        let resp = fetch_token(&self.client, cfg).await?;
        let token = resp.access_token.clone();
        self.store(key, resp);
        Ok(build_header(cfg, &token))
    }

    /// Force a fetch past the cache (the "Get token" button); caches the result.
    /// Returns the token lifetime in seconds.
    pub async fn force_fetch(
        &self,
        cfg: &OAuth2ClientCredentialsConfig,
    ) -> Result<u64, CoreError> {
        let resp = fetch_token(&self.client, cfg).await?;
        let secs = resp.expires_in_secs;
        self.store(CacheKey::from(cfg), resp);
        Ok(secs)
    }

    pub fn invalidate(&self, cfg: &OAuth2ClientCredentialsConfig) {
        self.cache
            .lock()
            .expect("token cache poisoned")
            .invalidate(&CacheKey::from(cfg));
    }

    fn store(&self, key: CacheKey, resp: TokenResponse) {
        let expires_at = Instant::now() + Duration::from_secs(resp.expires_in_secs);
        self.cache.lock().expect("token cache poisoned").put(
            key,
            CachedToken { access_token: resp.access_token, expires_at },
        );
    }

    #[cfg(test)]
    fn seed_for_test(&self, cfg: &OAuth2ClientCredentialsConfig, token: &str, ttl: Duration) {
        self.cache.lock().unwrap().put(
            CacheKey::from(cfg),
            CachedToken { access_token: token.to_string(), expires_at: Instant::now() + ttl },
        );
    }

    #[cfg(test)]
    fn has_cached_for_test(&self, cfg: &OAuth2ClientCredentialsConfig) -> bool {
        self.cache.lock().unwrap().get_fresh(&CacheKey::from(cfg), Instant::now()).is_some()
    }
}

impl Default for Oauth2TokenProvider {
    fn default() -> Self {
        Self::new()
    }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cargo test -p handshaker-core auth::oauth2`
Expected: PASS (13 tests).

- [ ] **Step 6: Commit**

```bash
git add Cargo.toml crates/handshaker-core/Cargo.toml crates/handshaker-core/src/auth/oauth2.rs
git commit -m "feat(core): Oauth2TokenProvider (reqwest+rustls-ring) with lazy cache"
```

### Task 5: Wiremock integration test for the network path

**Files:**
- Modify: `crates/handshaker-core/src/auth/oauth2.rs` (tests module)

- [ ] **Step 1: Write the failing test** — add to the `tests` module:

```rust
    use wiremock::matchers::{method, path};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    fn cfg_at(url: String) -> OAuth2ClientCredentialsConfig {
        let mut c = cfg();
        c.token_url = url;
        c
    }

    #[tokio::test]
    async fn force_fetch_against_mock_server_succeeds() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/token"))
            .respond_with(ResponseTemplate::new(200).set_body_string(
                r#"{"access_token":"live-tok","expires_in":120,"token_type":"Bearer"}"#,
            ))
            .mount(&server)
            .await;

        let provider = Oauth2TokenProvider::new();
        let cfg = cfg_at(format!("{}/token", server.uri()));
        let secs = provider.force_fetch(&cfg).await.unwrap();
        assert_eq!(secs, 120);
        // Now cached: header_for serves it without another request.
        let creds = provider.header_for(&cfg).await.unwrap();
        assert_eq!(creds.header_value, "Bearer live-tok");
    }

    #[tokio::test]
    async fn fetch_against_mock_error_surfaces_auth_error() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/token"))
            .respond_with(ResponseTemplate::new(401).set_body_string(
                r#"{"error":"invalid_client","error_description":"nope"}"#,
            ))
            .mount(&server)
            .await;

        let provider = Oauth2TokenProvider::new();
        let cfg = cfg_at(format!("{}/token", server.uri()));
        let err = provider.force_fetch(&cfg).await.unwrap_err();
        match err {
            CoreError::Auth(m) => assert!(m.contains("invalid_client") && m.contains("nope")),
            other => panic!("expected Auth, got {other:?}"),
        }
    }
```

- [ ] **Step 2: Run tests to verify they fail (then pass)**

Run: `cargo test -p handshaker-core auth::oauth2`
Expected: these two tests exercise existing code — they should compile and PASS once
`wiremock` is a dev-dependency (added in Task 4). If wiremock is missing, the failure is
a compile error on the `use wiremock::...` lines.

- [ ] **Step 3: Run the whole core suite**

Run: `cargo test -p handshaker-core`
Expected: PASS (all pre-existing core tests + the new oauth2 tests).

- [ ] **Step 4: Commit**

```bash
git add crates/handshaker-core/src/auth/oauth2.rs
git commit -m "test(core): wiremock integration for oauth2 token fetch (success + IdP error)"
```

### Task 6: Env-gate the core resolve chain

**Files:**
- Modify: `crates/handshaker-core/src/collections/resolve.rs`
- Test: same file (`#[cfg(test)] mod tests`)

- [ ] **Step 1: Write a failing test** — add to the `tests` module in `resolve.rs`
  (use the module's existing test helpers for building a `Collection`/`SavedRequest`;
  if a prod-only env-var config helper isn't present, construct one inline as below):

```rust
    #[test]
    fn collection_auth_scoped_to_prod_is_skipped_in_other_env() {
        use crate::auth::{EnvVarAuthConfig, SavedAuthConfig};
        use crate::env::Environment;

        // env var present so resolution would succeed IF the gate let it through.
        std::env::set_var("HS_TEST_PROD_TOKEN", "secret");
        let mut collection = test_collection(); // existing helper: empty single collection
        collection.auth = SavedAuthConfig::EnvVar(EnvVarAuthConfig {
            env_var: "HS_TEST_PROD_TOKEN".into(),
            header_name: "authorization".into(),
            prefix: "Bearer ".into(),
            environments: vec!["prod".into()],
        });
        let request = test_request(); // existing helper: request with auth = None

        let dev = Environment { name: "dev".into(), variables: Default::default(), color: None };
        let prod = Environment { name: "prod".into(), variables: Default::default(), color: None };

        // dev ⇒ gated out ⇒ no auth header.
        let eff_dev = resolve_request(&request, &collection, Some(&dev)).unwrap();
        assert!(eff_dev.auth.is_none());
        // prod ⇒ active ⇒ header present.
        let eff_prod = resolve_request(&request, &collection, Some(&prod)).unwrap();
        assert_eq!(eff_prod.auth.unwrap().header_value, "Bearer secret");

        std::env::remove_var("HS_TEST_PROD_TOKEN");
    }
```

> If `test_collection`/`test_request` helpers don't already exist in this module, add
> minimal ones mirroring the existing test setup in `resolve.rs` (a `Collection` with no
> items and `SavedAuthConfig::None`, and a `SavedRequest` with `auth: SavedAuthConfig::None`,
> empty metadata, a literal address, blank body). Reuse whatever the file already defines.

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test -p handshaker-core collections::resolve`
Expected: FAIL — current `resolve_auth_chain` ignores `environments`, so the dev case
returns a header.

- [ ] **Step 3: Implement.** In `resolve.rs`, change the `resolve_auth_chain` call site
  inside `resolve_request` to pass the active env name:

```rust
    // --- 3. Auth (nearest active config: request → collection; folders carry none) ---
    let auth = resolve_auth_chain(request, collection, active_env.map(|e| e.name.as_str()))?;
```

Replace `resolve_auth_chain` with:

```rust
/// Nearest active non-`None` config wins: request first, then collection. A config
/// scoped to environments that excludes `active_env` is skipped (treated as absent).
fn resolve_auth_chain(
    request: &SavedRequest,
    collection: &Collection,
    active_env: Option<&str>,
) -> Result<Option<crate::auth::AuthCredentials>, CoreError> {
    use crate::auth::{auth_active_for_env, SavedAuthConfig};
    for cfg in [&request.auth, &collection.auth] {
        let envs: &[String] = match cfg {
            SavedAuthConfig::None => continue,
            SavedAuthConfig::EnvVar(c) => &c.environments,
            SavedAuthConfig::OAuth2ClientCredentials(c) => &c.environments,
        };
        if !auth_active_for_env(envs, active_env) {
            continue;
        }
        return resolve_auth(cfg);
    }
    Ok(None)
}
```

> Note: an oauth2 config that passes the gate still returns `NotImplemented` from this
> sync path — the live send path uses the async provider via IPC. That is acceptable;
> this function is not on the live path. Existing `resolve.rs` tests don't cover oauth2.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cargo test -p handshaker-core collections::resolve`
Expected: PASS (the new test + all existing resolve tests).

- [ ] **Step 5: Commit**

```bash
git add crates/handshaker-core/src/collections/resolve.rs
git commit -m "feat(core): env-gate the auth resolve chain"
```

> 🧹 **/clear-чекпойнт** — Phase 2 complete. Run `cargo test -p handshaker-core` once
> more to confirm green, then start a fresh session for Phase 3.

---

# Phase 3 — IPC

### Task 7: Update the IPC auth DTOs

**Files:**
- Modify: `src-tauri/src/ipc/collection.rs`
- Modify: `src-tauri/src/ipc/auth.rs`
- Test: `src-tauri/src/ipc/collection.rs` (add a tests module if absent)

- [ ] **Step 1: Write failing tests** — add to (or create) a `#[cfg(test)] mod tests`
  in `src-tauri/src/ipc/collection.rs`:

```rust
    use super::*;

    #[test]
    fn oauth2_ipc_round_trips_through_core_with_new_fields() {
        let ipc = SavedAuthConfigIpc::Oauth2ClientCredentials {
            token_url: "u".into(),
            client_id: "c".into(),
            client_secret: "s".into(),
            scopes: vec!["a".into()],
            header_name: "x-auth".into(),
            prefix: "Token ".into(),
            environments: vec!["prod".into()],
        };
        let core = ipc.clone().into_core();
        let back = SavedAuthConfigIpc::from_core(core);
        assert_eq!(back, ipc);
    }

    #[test]
    fn oauth2_ipc_tag_is_pinned() {
        let ipc = SavedAuthConfigIpc::Oauth2ClientCredentials {
            token_url: "u".into(), client_id: "c".into(), client_secret: "s".into(),
            scopes: vec![], header_name: "authorization".into(), prefix: "Bearer ".into(),
            environments: vec![],
        };
        let json = serde_json::to_string(&ipc).unwrap();
        assert!(json.contains(r#""kind":"oauth2_client_credentials""#), "got {json}");
    }

    #[test]
    fn env_var_ipc_round_trips_environments() {
        let ipc = SavedAuthConfigIpc::EnvVar {
            env_var: "V".into(), header_name: "authorization".into(), prefix: "Bearer ".into(),
            environments: vec!["prod".into()],
        };
        let back = SavedAuthConfigIpc::from_core(ipc.clone().into_core());
        assert_eq!(back, ipc);
    }
```

> Add `#[derive(PartialEq)]` to `SavedAuthConfigIpc` if it isn't already derivable
> (it already derives `Clone, Serialize, Deserialize, Type`; add `PartialEq` for these
> asserts).

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd src-tauri ; cargo test --lib ipc::collection` (ensure `dist/` exists — see
Prerequisites; build it with `pnpm build` first if needed)
Expected: FAIL to compile (IPC variant still has `client_secret_env_var`, lacks new fields).

- [ ] **Step 3: Implement.** In `src-tauri/src/ipc/collection.rs`:

Add the default helpers near the top (module scope):

```rust
fn default_auth_header_name() -> String {
    "authorization".to_string()
}
fn default_auth_prefix() -> String {
    "Bearer ".to_string()
}
```

Replace the `SavedAuthConfigIpc` enum with (add `PartialEq`; pin the variant tag;
new fields):

```rust
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum SavedAuthConfigIpc {
    None,
    EnvVar {
        env_var: String,
        header_name: String,
        prefix: String,
        #[serde(default)]
        environments: Vec<String>,
    },
    #[serde(rename = "oauth2_client_credentials")]
    Oauth2ClientCredentials {
        token_url: String,
        client_id: String,
        client_secret: String,
        scopes: Vec<String>,
        #[serde(default = "default_auth_header_name")]
        header_name: String,
        #[serde(default = "default_auth_prefix")]
        prefix: String,
        #[serde(default)]
        environments: Vec<String>,
    },
}
```

Replace `from_core`/`into_core` bodies to carry the new fields:

```rust
    pub fn from_core(c: SavedAuthConfig) -> Self {
        match c {
            SavedAuthConfig::None => Self::None,
            SavedAuthConfig::EnvVar(e) => Self::EnvVar {
                env_var: e.env_var,
                header_name: e.header_name,
                prefix: e.prefix,
                environments: e.environments,
            },
            SavedAuthConfig::OAuth2ClientCredentials(o) => Self::Oauth2ClientCredentials {
                token_url: o.token_url,
                client_id: o.client_id,
                client_secret: o.client_secret,
                scopes: o.scopes,
                header_name: o.header_name,
                prefix: o.prefix,
                environments: o.environments,
            },
        }
    }

    pub fn into_core(self) -> SavedAuthConfig {
        match self {
            Self::None => SavedAuthConfig::None,
            Self::EnvVar { env_var, header_name, prefix, environments } => {
                SavedAuthConfig::EnvVar(EnvVarAuthConfig { env_var, header_name, prefix, environments })
            }
            Self::Oauth2ClientCredentials {
                token_url, client_id, client_secret, scopes, header_name, prefix, environments,
            } => SavedAuthConfig::OAuth2ClientCredentials(OAuth2ClientCredentialsConfig {
                token_url,
                client_id,
                client_secret,
                scopes,
                header_name,
                prefix,
                environments,
            }),
        }
    }
```

In `src-tauri/src/ipc/auth.rs` add the token-info DTO (after `AuthCredentialsIpc`):

```rust
/// Result of a forced token fetch (the "Get token" button) — lifetime only;
/// the token itself stays in the backend cache.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct OAuth2TokenInfoIpc {
    pub expires_in_secs: u64,
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd src-tauri ; cargo test --lib ipc`
Expected: PASS (new tests + existing ipc tests).

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/ipc/collection.rs src-tauri/src/ipc/auth.rs
git commit -m "feat(ipc): oauth2 DTO fields + pinned tag + OAuth2TokenInfoIpc"
```

### Task 8: AppState provider + commands + registration

**Files:**
- Modify: `src-tauri/src/state.rs`
- Modify: `src-tauri/src/commands/auth.rs`
- Modify: `src-tauri/src/lib.rs`
- Test: `src-tauri/src/commands/auth.rs`

- [ ] **Step 1: Add the provider to `AppState`.** In `src-tauri/src/state.rs`:

Import at the top:

```rust
use handshaker_core::auth::oauth2::Oauth2TokenProvider;
```

Add the field to the `AppState` struct:

```rust
    /// OAuth2 client-credentials token cache + HTTP client (session-lived).
    pub oauth2_provider: Oauth2TokenProvider,
```

Initialize it in BOTH `Default::default()` and `load()` (add this line to each struct
literal):

```rust
            oauth2_provider: Oauth2TokenProvider::new(),
```

- [ ] **Step 2: Write failing tests** — replace the `tests` module body in
  `src-tauri/src/commands/auth.rs` with impl-level tests (mirrors the `vars_resolve_impl`
  pattern — avoids constructing `tauri::State`):

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use crate::state::AppState;

    #[tokio::test]
    async fn none_resolves_to_no_header() {
        let state = AppState::default();
        assert!(state.auth_resolve_impl(SavedAuthConfigIpc::None).await.unwrap().is_none());
    }

    #[tokio::test]
    async fn env_var_resolves_to_prefixed_header() {
        let var = "HANDSHAKER_TEST_AUTH_RESOLVE_CMD";
        std::env::set_var(var, "tok123");
        let state = AppState::default();
        let cfg = SavedAuthConfigIpc::EnvVar {
            env_var: var.into(),
            header_name: "authorization".into(),
            prefix: "Bearer ".into(),
            environments: vec![],
        };
        let out = state.auth_resolve_impl(cfg).await.unwrap().unwrap();
        assert_eq!(out.header_name, "authorization");
        assert_eq!(out.header_value, "Bearer tok123");
        std::env::remove_var(var);
    }

    #[tokio::test]
    async fn fetch_token_rejects_non_oauth2_config() {
        let state = AppState::default();
        let err = state.auth_oauth2_fetch_token_impl(SavedAuthConfigIpc::None).await.unwrap_err();
        assert!(matches!(err, handshaker_core::error::CoreError::InvalidTarget(_)));
    }

    #[tokio::test]
    async fn invalidate_is_a_noop_for_non_oauth2() {
        let state = AppState::default();
        state.auth_invalidate_impl(SavedAuthConfigIpc::None); // must not panic
    }
}
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd src-tauri ; cargo test --lib commands::auth`
Expected: FAIL to compile (`auth_resolve_impl`, `auth_oauth2_fetch_token_impl`,
`auth_invalidate_impl` undefined).

- [ ] **Step 4: Implement.** Replace the non-test portion of
  `src-tauri/src/commands/auth.rs` with:

```rust
//! Auth-resolution IPC commands. `None`/`EnvVar` resolve synchronously in core;
//! `OAuth2` routes through the session token provider (`AppState::oauth2_provider`).

use handshaker_core::auth::{resolve_auth, SavedAuthConfig};
use tauri::State;

use crate::ipc::auth::{AuthCredentialsIpc, OAuth2TokenInfoIpc};
use crate::ipc::collection::SavedAuthConfigIpc;
use crate::ipc::error::IpcError;
use crate::state::AppState;
use handshaker_core::error::CoreError;

impl AppState {
    pub async fn auth_resolve_impl(
        &self,
        config: SavedAuthConfigIpc,
    ) -> Result<Option<AuthCredentialsIpc>, CoreError> {
        match config.into_core() {
            SavedAuthConfig::OAuth2ClientCredentials(c) => {
                let creds = self.oauth2_provider.header_for(&c).await?;
                Ok(Some(AuthCredentialsIpc::from_core(creds)))
            }
            other => Ok(resolve_auth(&other)?.map(AuthCredentialsIpc::from_core)),
        }
    }

    pub async fn auth_oauth2_fetch_token_impl(
        &self,
        config: SavedAuthConfigIpc,
    ) -> Result<OAuth2TokenInfoIpc, CoreError> {
        match config.into_core() {
            SavedAuthConfig::OAuth2ClientCredentials(c) => {
                let expires_in_secs = self.oauth2_provider.force_fetch(&c).await?;
                Ok(OAuth2TokenInfoIpc { expires_in_secs })
            }
            _ => Err(CoreError::InvalidTarget(
                "auth_oauth2_fetch_token requires an oauth2 config".into(),
            )),
        }
    }

    pub fn auth_invalidate_impl(&self, config: SavedAuthConfigIpc) {
        if let SavedAuthConfig::OAuth2ClientCredentials(c) = config.into_core() {
            self.oauth2_provider.invalidate(&c);
        }
    }
}

#[tauri::command]
#[specta::specta]
pub async fn auth_resolve(
    state: State<'_, AppState>,
    config: SavedAuthConfigIpc,
) -> Result<Option<AuthCredentialsIpc>, IpcError> {
    state.auth_resolve_impl(config).await.map_err(IpcError::from)
}

#[tauri::command]
#[specta::specta]
pub async fn auth_oauth2_fetch_token(
    state: State<'_, AppState>,
    config: SavedAuthConfigIpc,
) -> Result<OAuth2TokenInfoIpc, IpcError> {
    state.auth_oauth2_fetch_token_impl(config).await.map_err(IpcError::from)
}

#[tauri::command]
#[specta::specta]
pub async fn auth_invalidate(
    state: State<'_, AppState>,
    config: SavedAuthConfigIpc,
) -> Result<(), IpcError> {
    state.auth_invalidate_impl(config);
    Ok(())
}
```

- [ ] **Step 5: Register the new commands.** In `src-tauri/src/lib.rs`:

Change the import line:

```rust
use commands::auth::{auth_invalidate, auth_oauth2_fetch_token, auth_resolve};
```

Add the two commands to the `collect_commands![ ... ]` list (next to `auth_resolve`):

```rust
            auth_resolve,
            auth_oauth2_fetch_token,
            auth_invalidate,
```

- [ ] **Step 6: Run the backend suite**

Run (ensure `dist/` exists first): `cd src-tauri ; cargo test --lib`
Expected: PASS (commands::auth tests + all existing).

- [ ] **Step 7: Regenerate the TS bindings**

Run: `cargo run -p handshaker --bin export-bindings --features export-bindings`
Expected: writes `src/ipc/bindings.ts`. Confirm it contains
`"oauth2_client_credentials"`, the new fields on the env_var/oauth2 variants, the
`authOauth2FetchToken` and `authInvalidate` command wrappers, and `OAuth2TokenInfoIpc`.

- [ ] **Step 8: Commit**

```bash
git add src-tauri/src/state.rs src-tauri/src/commands/auth.rs src-tauri/src/lib.rs src/ipc/bindings.ts
git commit -m "feat(ipc): oauth2 token provider in AppState + fetch/invalidate commands + bindings"
```

> 🧹 **/clear-чекпойнт** — Phase 3 complete. Backend is whole; frontend follows.

---

# Phase 4 — Frontend

### Task 9: authConfigMap — full oauth2 + env-scope mapping

**Files:**
- Modify: `src/features/catalog/overview/authConfigMap.ts`
- Test: `src/features/catalog/overview/authConfigMap.test.ts` (create)

- [ ] **Step 1: Write failing tests** — create
  `src/features/catalog/overview/authConfigMap.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { configToForm, formToConfig, AUTH_FORM_DEFAULTS } from "./authConfigMap";
import type { SavedAuthConfigIpc } from "@/ipc/bindings";

describe("authConfigMap", () => {
  it("maps oauth2 config to form and back (round trip)", () => {
    const cfg: SavedAuthConfigIpc = {
      kind: "oauth2_client_credentials",
      token_url: "https://idp/token",
      client_id: "cid",
      client_secret: "{{secret}}",
      scopes: ["a", "b"],
      header_name: "authorization",
      prefix: "Bearer ",
      environments: ["prod"],
    };
    const form = configToForm(cfg);
    expect(form.kind).toBe("oauth2");
    expect(form.scope).toBe("a b");
    expect(form.environments).toEqual(["prod"]);
    expect(formToConfig(form)).toEqual(cfg);
  });

  it("splits scope on whitespace and drops empties", () => {
    const form = { ...AUTH_FORM_DEFAULTS, kind: "oauth2" as const, scope: "  a   b  " };
    const cfg = formToConfig(form);
    expect(cfg.kind === "oauth2_client_credentials" && cfg.scopes).toEqual(["a", "b"]);
  });

  it("carries environments on bearer/apikey", () => {
    const form = { ...AUTH_FORM_DEFAULTS, kind: "bearer" as const, envVar: "T", environments: ["prod"] };
    const cfg = formToConfig(form);
    expect(cfg.kind === "env_var" && cfg.environments).toEqual(["prod"]);
  });

  it("oauth2 form falls back to default header/prefix when blank", () => {
    const form = { ...AUTH_FORM_DEFAULTS, kind: "oauth2" as const, oauthHeaderName: "  " };
    const cfg = formToConfig(form);
    expect(cfg.kind === "oauth2_client_credentials" && cfg.header_name).toBe("authorization");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test authConfigMap`
Expected: FAIL (form has no `scope`/`environments`; oauth2 currently maps to `none`).

- [ ] **Step 3: Implement.** Replace `src/features/catalog/overview/authConfigMap.ts`
  entirely with:

```ts
import type { SavedAuthConfigIpc } from "@/ipc/bindings";

export type AuthFormKind = "none" | "bearer" | "apikey" | "oauth2";

export interface AuthForm {
  kind: AuthFormKind;
  // env_var (bearer/apikey)
  envVar: string;
  headerName: string;
  prefix: string;
  // oauth2
  tokenUrl: string;
  clientId: string;
  clientSecret: string;
  scope: string; // space-separated; maps to scopes[]
  oauthHeaderName: string;
  oauthPrefix: string;
  // env gating (env_var + oauth2). Empty = all environments.
  environments: string[];
}

export const OAUTH_DEFAULT_HEADER = "authorization";
export const OAUTH_DEFAULT_PREFIX = "Bearer ";

export const AUTH_FORM_DEFAULTS: AuthForm = {
  kind: "none",
  envVar: "",
  headerName: "x-api-key",
  prefix: "",
  tokenUrl: "",
  clientId: "",
  clientSecret: "",
  scope: "",
  oauthHeaderName: OAUTH_DEFAULT_HEADER,
  oauthPrefix: OAUTH_DEFAULT_PREFIX,
  environments: [],
};

const BEARER_HEADER = "authorization";
const BEARER_PREFIX = "Bearer ";

/** Map a stored single-auth config to the editor form. */
export function configToForm(config: SavedAuthConfigIpc): AuthForm {
  switch (config.kind) {
    case "none":
      return { ...AUTH_FORM_DEFAULTS };
    case "env_var": {
      const isBearer = config.header_name === BEARER_HEADER && config.prefix === BEARER_PREFIX;
      return {
        ...AUTH_FORM_DEFAULTS,
        kind: isBearer ? "bearer" : "apikey",
        envVar: config.env_var,
        headerName: config.header_name,
        prefix: config.prefix,
        environments: config.environments ?? [],
      };
    }
    case "oauth2_client_credentials":
      return {
        ...AUTH_FORM_DEFAULTS,
        kind: "oauth2",
        tokenUrl: config.token_url,
        clientId: config.client_id,
        clientSecret: config.client_secret,
        scope: config.scopes.join(" "),
        oauthHeaderName: config.header_name,
        oauthPrefix: config.prefix,
        environments: config.environments ?? [],
      };
  }
}

/** Map the editor form back to a stored single-auth config. */
export function formToConfig(form: AuthForm): SavedAuthConfigIpc {
  switch (form.kind) {
    case "none":
      return { kind: "none" };
    case "bearer":
      return {
        kind: "env_var",
        env_var: form.envVar.trim(),
        header_name: BEARER_HEADER,
        prefix: BEARER_PREFIX,
        environments: form.environments,
      };
    case "apikey":
      return {
        kind: "env_var",
        env_var: form.envVar.trim(),
        header_name: form.headerName.trim() || "x-api-key",
        prefix: form.prefix,
        environments: form.environments,
      };
    case "oauth2":
      return {
        kind: "oauth2_client_credentials",
        token_url: form.tokenUrl.trim(),
        client_id: form.clientId.trim(),
        client_secret: form.clientSecret,
        scopes: form.scope.split(/\s+/).filter(Boolean),
        header_name: form.oauthHeaderName.trim() || OAUTH_DEFAULT_HEADER,
        prefix: form.oauthPrefix,
        environments: form.environments,
      };
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test authConfigMap`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/features/catalog/overview/authConfigMap.ts src/features/catalog/overview/authConfigMap.test.ts
git commit -m "feat(ui): authConfigMap maps full oauth2 + env scope"
```

### Task 10: resolveAuthHeader — env-gate + var resolution + invalidate handle

**Files:**
- Modify: `src/features/workflow/actions.ts`
- Modify: `src/ipc/client.ts`
- Test: `src/features/workflow/resolveAuthHeader.test.ts` (create)

- [ ] **Step 1: Add the IPC wrappers.** In `src/ipc/client.ts`:

Add to the imports from `@/ipc/bindings` the `OAuth2TokenInfoIpc` type, then add these
wrappers (next to `authResolve`):

```ts
export async function authOauth2FetchToken(
  config: SavedAuthConfigIpc,
): Promise<OAuth2TokenInfoIpc> {
  const r = await commands.authOauth2FetchToken(config);
  if (r.status === "error") throw r.error;
  return r.data;
}

export async function authInvalidate(config: SavedAuthConfigIpc): Promise<void> {
  const r = await commands.authInvalidate(config);
  if (r.status === "error") throw r.error;
}
```

Add both to the exported `ipc` object (after `authResolve`):

```ts
  authResolve,
  authOauth2FetchToken,
  authInvalidate,
```

- [ ] **Step 2: Write failing tests** — create
  `src/features/workflow/resolveAuthHeader.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { resolveAuthHeader } from "./actions";
import type { SavedAuthConfigIpc, AuthCredentialsIpc, ResolutionReportIpc } from "@/ipc/bindings";

const report = (resolved: string, unresolved: string[] = []): ResolutionReportIpc => ({
  resolved,
  unresolved_vars: unresolved,
  cycle_chain: null,
});

const okCreds: AuthCredentialsIpc = { header_name: "authorization", header_value: "Bearer T" };

describe("resolveAuthHeader", () => {
  const passthroughVars = (t: string) => Promise.resolve(report(t));

  it("returns none for kind none", async () => {
    const r = await resolveAuthHeader({ kind: "none" }, "prod", {
      authResolve: vi.fn(),
      varsResolve: passthroughVars,
    });
    expect(r.kind).toBe("none");
  });

  it("gates out a prod-scoped config in a different env", async () => {
    const auth: SavedAuthConfigIpc = {
      kind: "env_var", env_var: "T", header_name: "authorization", prefix: "Bearer ", environments: ["prod"],
    };
    const authResolve = vi.fn();
    const r = await resolveAuthHeader(auth, "dev", { authResolve, varsResolve: passthroughVars });
    expect(r.kind).toBe("none");
    expect(authResolve).not.toHaveBeenCalled();
  });

  it("gates out a prod-scoped config under No environment (null)", async () => {
    const auth: SavedAuthConfigIpc = {
      kind: "env_var", env_var: "T", header_name: "authorization", prefix: "Bearer ", environments: ["prod"],
    };
    const r = await resolveAuthHeader(auth, null, { authResolve: vi.fn(), varsResolve: passthroughVars });
    expect(r.kind).toBe("none");
  });

  it("resolves oauth2 vars and returns the header + invalidate handle", async () => {
    const auth: SavedAuthConfigIpc = {
      kind: "oauth2_client_credentials",
      token_url: "https://idp/token",
      client_id: "cid",
      client_secret: "{{secret}}",
      scopes: [],
      header_name: "authorization",
      prefix: "Bearer ",
      environments: [],
    };
    const varsResolve = vi.fn(async (t: string) => report(t === "{{secret}}" ? "S3CRET" : t));
    const authResolve = vi.fn(async () => okCreds);
    const r = await resolveAuthHeader(auth, "prod", { authResolve, varsResolve });
    expect(r.kind).toBe("header");
    if (r.kind === "header") {
      expect(r.header).toEqual({ key: "authorization", value: "Bearer T" });
      // the resolved (var-substituted) config is handed back for invalidation
      expect(r.invalidate?.kind).toBe("oauth2_client_credentials");
      if (r.invalidate?.kind === "oauth2_client_credentials") {
        expect(r.invalidate.client_secret).toBe("S3CRET");
      }
    }
    // authResolve was called with the RESOLVED config, not the templated one
    expect(authResolve.mock.calls[0][0]).toMatchObject({ client_secret: "S3CRET" });
  });

  it("errors when an oauth2 var is unresolved", async () => {
    const auth: SavedAuthConfigIpc = {
      kind: "oauth2_client_credentials",
      token_url: "{{url}}", client_id: "c", client_secret: "s", scopes: [],
      header_name: "authorization", prefix: "Bearer ", environments: [],
    };
    const varsResolve = vi.fn(async (t: string) =>
      t === "{{url}}" ? report("{{url}}", ["url"]) : report(t),
    );
    const r = await resolveAuthHeader(auth, "prod", { authResolve: vi.fn(), varsResolve });
    expect(r.kind).toBe("error");
    if (r.kind === "error") expect(r.message).toContain("url");
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `pnpm test resolveAuthHeader`
Expected: FAIL (`resolveAuthHeader` still has the old 2-arg signature; no env-gate).

- [ ] **Step 4: Implement.** In `src/features/workflow/actions.ts`:

Add `ResolutionReportIpc` to the type imports from `@/ipc/bindings`. Replace the
`AuthHeaderResult` type and `resolveAuthHeader` function with:

```ts
export type AuthHeader = { key: string; value: string };

export type AuthHeaderResult =
  | { kind: "none" }
  | { kind: "header"; header: AuthHeader; invalidate?: SavedAuthConfigIpc }
  | { kind: "error"; message: string };

export interface AuthDeps {
  authResolve: (c: SavedAuthConfigIpc) => Promise<AuthCredentialsIpc | null>;
  varsResolve: (t: string) => Promise<ResolutionReportIpc>;
}

/** Environments a config is scoped to ([] = all). */
function authEnvironments(auth: SavedAuthConfigIpc): string[] {
  if (auth.kind === "env_var" || auth.kind === "oauth2_client_credentials") {
    return auth.environments ?? [];
  }
  return [];
}

type Oauth2Config = Extract<SavedAuthConfigIpc, { kind: "oauth2_client_credentials" }>;

/** Resolve `{{var}}` in every oauth2 template field. Returns the resolved config, or
 *  the list of unresolved variable names. */
export async function resolveOauthConfig(
  auth: Oauth2Config,
  varsResolve: (t: string) => Promise<ResolutionReportIpc>,
): Promise<{ ok: true; config: Oauth2Config } | { ok: false; message: string }> {
  const unresolved: string[] = [];
  const take = async (t: string): Promise<string> => {
    const r = await varsResolve(t);
    for (const v of r.unresolved_vars) if (!unresolved.includes(v)) unresolved.push(v);
    return r.resolved;
  };
  const token_url = await take(auth.token_url);
  const client_id = await take(auth.client_id);
  const client_secret = await take(auth.client_secret);
  const scopes: string[] = [];
  for (const s of auth.scopes) scopes.push(await take(s));
  if (unresolved.length > 0) {
    return {
      ok: false,
      message: `Unresolved variables: ${unresolved.map((v) => `{{${v}}}`).join(", ")}`,
    };
  }
  return {
    ok: true,
    config: {
      kind: "oauth2_client_credentials",
      token_url,
      client_id,
      client_secret,
      scopes,
      header_name: auth.header_name,
      prefix: auth.prefix,
      environments: auth.environments,
    },
  };
}

/** Resolve the auth header for a step. Env-gates scoped configs against `activeEnv`,
 *  resolves `{{var}}` for oauth2 fields, and returns the resolved oauth2 config as an
 *  `invalidate` handle (used to drop the cached token on a gRPC UNAUTHENTICATED). */
export async function resolveAuthHeader(
  auth: SavedAuthConfigIpc,
  activeEnv: string | null,
  deps: AuthDeps,
): Promise<AuthHeaderResult> {
  if (auth.kind === "none") return { kind: "none" };

  const envs = authEnvironments(auth);
  if (envs.length > 0 && (activeEnv === null || !envs.includes(activeEnv))) {
    return { kind: "none" };
  }

  try {
    if (auth.kind === "oauth2_client_credentials") {
      const resolved = await resolveOauthConfig(auth, deps.varsResolve);
      if (!resolved.ok) return { kind: "error", message: resolved.message };
      const creds = await deps.authResolve(resolved.config);
      if (!creds) return { kind: "none" };
      return {
        kind: "header",
        header: { key: creds.header_name, value: creds.header_value },
        invalidate: resolved.config,
      };
    }
    const creds = await deps.authResolve(auth);
    if (!creds) return { kind: "none" };
    return { kind: "header", header: { key: creds.header_name, value: creds.header_value } };
  } catch (e) {
    return { kind: "error", message: errorToMessage(e) };
  }
}
```

> `errorToMessage` already exists at the bottom of `actions.ts` — reuse it.

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm test resolveAuthHeader`
Expected: PASS (5 tests).

- [ ] **Step 6: Commit**

```bash
git add src/features/workflow/actions.ts src/ipc/client.ts
git commit -m "feat(ui): resolveAuthHeader env-gate + oauth2 var resolution + invalidate handle"
```

### Task 11: CallPanel — wire active env, deps, and invalidate-on-16

**Files:**
- Modify: `src/features/workflow/CallPanel.tsx`
- Test: `src/features/workflow/CallPanel.editable.test.tsx` (extend) — or the existing
  CallPanel test file that mocks `@/ipc/client`.

- [ ] **Step 1: Write a failing test.** In the CallPanel test file that already mocks
  `@/ipc/client` (it mocks `authResolve`), add a case asserting that a successful send
  returning status 16 with an oauth2 auth triggers `authInvalidate`. Mock additions:

```ts
// in the vi.mock("@/ipc/client", ...) factory, ensure these exist:
//   authResolve: vi.fn().mockResolvedValue({ header_name: "authorization", header_value: "Bearer T" }),
//   varsResolve: vi.fn(async (t: string) => ({ resolved: t, unresolved_vars: [], cycle_chain: null })),
//   authInvalidate: vi.fn().mockResolvedValue(undefined),
//   ipc: { grpcInvokeOneshot: vi.fn(), varsResolve: <same as above>, ... }

it("invalidates the oauth2 token cache when a send returns UNAUTHENTICATED (16)", async () => {
  // Arrange a draft step whose auth is an unscoped oauth2 config, mock
  // grpcInvokeOneshot (via ipc) to resolve with status_code: 16, render <CallPanel editable>,
  // click Send, then:
  await waitFor(() => expect(authInvalidate).toHaveBeenCalledTimes(1));
});
```

> Match the exact mock shape already used by the existing CallPanel test (it stubs
> `sendStep`'s dependencies through `@/ipc/client`'s `ipc` object). Follow that file's
> established render+click pattern; the assertion is `authInvalidate` was called once.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test CallPanel`
Expected: FAIL — current `onSend` never calls `authInvalidate`.

- [ ] **Step 3: Implement.** In `src/features/workflow/CallPanel.tsx`:

Update the import from `@/ipc/client`:

```ts
import { authResolve, varsResolve, authInvalidate } from "@/ipc/client";
```

Import the active workflow hook (already in this feature folder):

```ts
import { useActiveWorkflow } from "./store";
```

Inside `CallPanel`, read the active env (the active env is a global session concept,
mirrored on the active workflow):

```ts
  const activeWf = useActiveWorkflow();
```

Replace the `onSend` body with:

```ts
  const onSend = async () => {
    const requestId = newId();
    onPatch({ status: "sending", error: null, requestId });
    const auth = await resolveAuthHeader(step.auth, activeWf.envName, { authResolve, varsResolve });
    if (auth.kind === "error") {
      onPatch({ status: "error", outcome: null, error: auth.message, requestId: null });
      return;
    }
    const res = await sendStep(step, auth.kind === "header" ? auth.header : null, { requestId });
    const patch = { ...stepPatchFromSendResult(res), requestId: null };
    onPatch(patch);
    // Drop the cached oauth2 token if the server rejected it (gRPC UNAUTHENTICATED = 16):
    // the next Send fetches a fresh one. No auto-retry (master design: A).
    if (
      res.kind === "ok" &&
      res.outcome.status_code === 16 &&
      auth.kind === "header" &&
      auth.invalidate
    ) {
      void authInvalidate(auth.invalidate);
    }
    if (onExecuted && shouldRecordExecuted(res)) onExecuted(buildExecutedStep(step, patch));
  };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test CallPanel`
Expected: PASS (new test + existing CallPanel tests). If the existing test's
`@/ipc/client` mock lacks `varsResolve`/`authInvalidate`, add them to that mock factory.

- [ ] **Step 5: Commit**

```bash
git add src/features/workflow/CallPanel.tsx src/features/workflow/CallPanel.editable.test.tsx
git commit -m "feat(ui): CallPanel passes active env + invalidates oauth2 token on status 16"
```

### Task 12: SavedAuthEditor — oauth2 form, Get token, env-scope popover

**Files:**
- Modify: `src/features/catalog/overview/SavedAuthEditor.tsx`
- Test: `src/features/catalog/overview/SavedAuthEditor.test.tsx` (create)

- [ ] **Step 1: Write failing tests** — create
  `src/features/catalog/overview/SavedAuthEditor.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { SavedAuthEditor } from "./SavedAuthEditor";
import type { SavedAuthConfigIpc } from "@/ipc/bindings";

vi.mock("@/ipc/client", () => ({
  ipc: {
    envList: vi.fn().mockResolvedValue([{ name: "prod", variables: {}, color: null }]),
    varsResolve: vi.fn(async (t: string) => ({ resolved: t, unresolved_vars: [], cycle_chain: null })),
    authOauth2FetchToken: vi.fn().mockResolvedValue({ expires_in_secs: 840 }),
  },
}));
import { ipc } from "@/ipc/client";

const oauth2: SavedAuthConfigIpc = {
  kind: "oauth2_client_credentials",
  token_url: "https://idp/token",
  client_id: "cid",
  client_secret: "{{secret}}",
  scopes: ["api"],
  header_name: "authorization",
  prefix: "Bearer ",
  environments: [],
};

describe("SavedAuthEditor (oauth2)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renders the oauth2 fields when the config is oauth2", () => {
    render(<SavedAuthEditor value={oauth2} onChange={() => {}} />);
    expect(screen.getByDisplayValue("https://idp/token")).toBeTruthy();
    expect(screen.getByDisplayValue("cid")).toBeTruthy();
  });

  it("Get token resolves vars, calls the backend, and shows the lifetime", async () => {
    render(<SavedAuthEditor value={oauth2} onChange={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /get token/i }));
    await waitFor(() => expect(ipc.authOauth2FetchToken).toHaveBeenCalledTimes(1));
    expect(await screen.findByText(/expires in 14 min/i)).toBeTruthy(); // 840s ≈ 14 min
  });

  it("editing a field emits an updated config via onChange", () => {
    const onChange = vi.fn();
    render(<SavedAuthEditor value={oauth2} onChange={onChange} />);
    fireEvent.change(screen.getByDisplayValue("cid"), { target: { value: "cid2" } });
    expect(onChange).toHaveBeenCalled();
    const last = onChange.mock.calls.at(-1)![0] as SavedAuthConfigIpc;
    expect(last.kind === "oauth2_client_credentials" && last.client_id).toBe("cid2");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test SavedAuthEditor`
Expected: FAIL — current editor shows a read-only oauth2 notice; no fields, no button.

- [ ] **Step 3: Implement.** Replace `src/features/catalog/overview/SavedAuthEditor.tsx`
  with the version below. It adds OAuth2 to the toggle, the field set, a "Get token"
  button with inline status, and an "Apply in environments" popover (uses the existing
  shadcn `ui/popover`):

```tsx
import { useEffect, useState } from "react";
import { Key } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ToggleGroup } from "@/components/ui/toggle-group";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { SavedAuthConfigIpc } from "@/ipc/bindings";
import { ipc } from "@/ipc/client";
import { EnvVarField } from "./EnvVarField";
import { configToForm, formToConfig, type AuthForm } from "./authConfigMap";
import { resolveOauthConfig } from "@/features/workflow/actions";

export interface SavedAuthEditorProps {
  value: SavedAuthConfigIpc;
  onChange: (next: SavedAuthConfigIpc) => void;
}

const KIND_OPTIONS = [
  { value: "none", label: "None" },
  { value: "bearer", label: "Bearer" },
  { value: "apikey", label: "API key" },
  { value: "oauth2", label: "OAuth2" },
];

type TokenStatus =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "ok"; message: string }
  | { kind: "error"; message: string };

function msg(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (e && typeof e === "object" && "message" in e) return String((e as { message: unknown }).message);
  return String(e);
}

export function SavedAuthEditor({ value, onChange }: SavedAuthEditorProps) {
  const form = configToForm(value);
  const patch = (next: Partial<AuthForm>) => onChange(formToConfig({ ...form, ...next }));

  const [envNames, setEnvNames] = useState<string[]>([]);
  useEffect(() => {
    void ipc.envList().then((envs) => setEnvNames(envs.map((e) => e.name))).catch(() => {});
  }, []);

  const [token, setToken] = useState<TokenStatus>({ kind: "idle" });
  const onGetToken = async () => {
    const cfg = formToConfig(form);
    if (cfg.kind !== "oauth2_client_credentials") return;
    setToken({ kind: "loading" });
    const resolved = await resolveOauthConfig(cfg, ipc.varsResolve);
    if (!resolved.ok) {
      setToken({ kind: "error", message: resolved.message });
      return;
    }
    try {
      const info = await ipc.authOauth2FetchToken(resolved.config);
      setToken({ kind: "ok", message: `Token acquired · expires in ${Math.round(info.expires_in_secs / 60)} min` });
    } catch (e) {
      setToken({ kind: "error", message: msg(e) });
    }
  };

  const toggleEnv = (name: string) => {
    const has = form.environments.includes(name);
    patch({ environments: has ? form.environments.filter((n) => n !== name) : [...form.environments, name] });
  };

  const envScopeRow = form.kind !== "none" && (
    <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
      <span>Apply in environments:</span>
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm" className="h-7 text-xs">
            {form.environments.length === 0 ? "All environments" : form.environments.join(", ")}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-56 p-1">
          {envNames.length === 0 && <div className="px-2 py-1.5 text-xs text-muted-foreground">No environments</div>}
          {envNames.map((name) => (
            <button
              key={name}
              type="button"
              onClick={() => toggleEnv(name)}
              className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-accent"
            >
              <span className="w-3">{form.environments.includes(name) ? "✓" : ""}</span>
              <span>{name}</span>
            </button>
          ))}
        </PopoverContent>
      </Popover>
    </div>
  );

  return (
    <div className="grid gap-4">
      <ToggleGroup
        value={form.kind}
        onValueChange={(v) => patch({ kind: v as AuthForm["kind"] })}
        options={KIND_OPTIONS}
      />

      {form.kind === "none" && (
        <div className="py-1 text-xs text-muted-foreground">
          No authentication is attached to this collection's requests.
        </div>
      )}

      {form.kind === "bearer" && (
        <EnvVarField label="Token" value={form.envVar} onChange={(v) => patch({ envVar: v })} placeholder="BEARER_TOKEN_VAR" />
      )}

      {form.kind === "apikey" && (
        <>
          <div className="grid gap-1.5">
            <Label className="text-xs">Header name</Label>
            <Input value={form.headerName} onChange={(e) => patch({ headerName: e.target.value })} className="h-9 font-mono text-[12.5px]" />
          </div>
          <EnvVarField label="Value" value={form.envVar} onChange={(v) => patch({ envVar: v })} placeholder="API_KEY_VAR" />
        </>
      )}

      {form.kind === "oauth2" && (
        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <Label className="text-xs">Token URL</Label>
            <Input value={form.tokenUrl} onChange={(e) => patch({ tokenUrl: e.target.value })} placeholder="https://idp/realms/x/protocol/openid-connect/token" className="h-9 font-mono text-[12.5px]" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label className="text-xs">Client ID</Label>
              <Input value={form.clientId} onChange={(e) => patch({ clientId: e.target.value })} className="h-9 font-mono text-[12.5px]" />
            </div>
            <div className="grid gap-1.5">
              <Label className="text-xs">Client secret</Label>
              <Input value={form.clientSecret} onChange={(e) => patch({ clientSecret: e.target.value })} placeholder="{{secret}}" className="h-9 font-mono text-[12.5px]" />
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label className="text-xs">Scope</Label>
            <Input value={form.scope} onChange={(e) => patch({ scope: e.target.value })} placeholder="scope-a scope-b" className="h-9 font-mono text-[12.5px]" />
          </div>
          <details className="text-xs text-muted-foreground">
            <summary className="cursor-pointer select-none">Header & prefix</summary>
            <div className="mt-2 grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label className="text-xs">Header name</Label>
                <Input value={form.oauthHeaderName} onChange={(e) => patch({ oauthHeaderName: e.target.value })} className="h-9 font-mono text-[12.5px]" />
              </div>
              <div className="grid gap-1.5">
                <Label className="text-xs">Prefix</Label>
                <Input value={form.oauthPrefix} onChange={(e) => patch({ oauthPrefix: e.target.value })} className="h-9 font-mono text-[12.5px]" />
              </div>
            </div>
          </details>
          <div className="flex items-center gap-3">
            <Button variant="outline" size="sm" onClick={onGetToken} disabled={token.kind === "loading"}>
              {token.kind === "loading" ? "Getting token…" : "Get token"}
            </Button>
            {token.kind === "ok" && <span className="text-[11px] text-emerald-500">{token.message}</span>}
            {token.kind === "error" && <span className="text-[11px] text-destructive">{token.message}</span>}
          </div>
        </div>
      )}

      {envScopeRow}

      <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <Key className="size-3 shrink-0" />
        <span>
          OAuth2 fields accept <code>{"{{variables}}"}</code>; put the client secret in an
          environment variable. Bearer / API key reference an OS env-var name.
        </span>
      </div>
    </div>
  );
}
```

> Verify the import paths for `Button` and `Popover` match the repo
> (`@/components/ui/button`, `@/components/ui/popover` — the popover was added during the
> env-editor work). If `ToggleGroup`'s `options` prop doesn't render four items cleanly,
> follow its existing API (it already takes `options`). The `details/summary` keeps
> header/prefix secondary per the spec.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test SavedAuthEditor`
Expected: PASS (3 tests).

- [ ] **Step 5: Full frontend gate**

Run: `pnpm lint && pnpm test && pnpm build`
Expected: tsc clean, all vitest green (existing + new), production build succeeds.

- [ ] **Step 6: Commit**

```bash
git add src/features/catalog/overview/SavedAuthEditor.tsx src/features/catalog/overview/SavedAuthEditor.test.tsx
git commit -m "feat(ui): editable OAuth2 auth — fields, Get token, env-scope popover"
```

---

## Final verification (whole-branch gate)

- [ ] **Backend:** `cargo test -p handshaker-core && (cd src-tauri && cargo test --lib)` — green.
- [ ] **Bindings fresh:** re-run `cargo run -p handshaker --bin export-bindings --features export-bindings`; `git diff --exit-code src/ipc/bindings.ts` shows no drift.
- [ ] **Frontend:** `pnpm lint && pnpm test && pnpm build` — green.
- [ ] **Live (WebView2):** `pnpm tauri:dev`. Manually verify against a real OIDC token
  endpoint: (1) set an env var for the secret; (2) configure collection Auth → OAuth2,
  reference `{{secret}}`; (3) "Get token" shows a lifetime; (4) scope the config to `prod`
  and confirm a request in `dev` sends no `authorization` header, in `prod` it does;
  (5) send a real call and confirm the Bearer token is attached.
- [ ] On green, follow superpowers:finishing-a-development-branch (ff-merge to `main`),
  then archive this plan + the spec per CLAUDE.md and update the "Active work" line.

## Self-Review notes (author)

- **Spec coverage:** model rename + new fields (Task 1, 7); core oauth2 module — fetch,
  cache, provider, skew, key (Tasks 2–5); env helper + chain gate (Tasks 1, 6); IPC
  provider + 3 commands (Task 8); frontend var-resolution + env-gate + invalidate-on-16
  (Tasks 10, 11); editor with Get token + env popover (Task 12); tests at every layer.
- **Out-of-scope (per spec):** no auto-retry, no background refresh, no concurrent-fetch
  dedup, no persistent `AuthByEnv` map, no other grant types — none introduced.
- **Type consistency:** `resolveOauthConfig`, `Oauth2Config`, `AuthDeps`, `AuthHeaderResult`,
  `CacheKey`, `Oauth2TokenProvider::{header_for,force_fetch,invalidate}`,
  `auth_*_impl`, `OAuth2TokenInfoIpc`, `authOauth2FetchToken`/`authInvalidate` are used
  identically across tasks. TS oauth2 tag literal is `oauth2_client_credentials` everywhere
  (pinned in Tasks 1 & 7).
