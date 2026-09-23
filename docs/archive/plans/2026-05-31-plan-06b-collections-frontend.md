# Collections Frontend — Address Bar + Send/Save Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rewire the frontend from an explicit Connect/Disconnect connection model onto the #1 backend's `ContractCache`, using a lazy connect-on-Send model, a frontend `useCollections` data layer, a single `currentRequest` draft, and a Save-request dialog.

**Architecture:** The held `GrpcConnection` (`state.connection`) is removed. The `ContractCache` becomes the sole holder of descriptor pools/catalogs between calls. Backend commands become target-based: `grpc_describe` (cache-first), `grpc_refresh_contract`, `grpc_build_request_skeleton`, `grpc_invoke_oneshot` (activate→invoke→drop). The address bar auto-reflects on blur/debounce; Send invokes one-shot; Save persists into a collection.

**Tech Stack:** Rust (handshaker-core + Tauri shell), tauri-specta v2 (regenerated `bindings.ts`), React 18 + TypeScript, Tailwind v4, lucide-react, shadcn/ui primitives, Monaco.

**Spec:** `docs/superpowers/specs/2026-05-31-plan-06b-collections-frontend-design.md`

---

## File structure

**handshaker-core:**
- Modify `crates/handshaker-core/src/grpc/invoke/mod.rs` — add `build_request_skeleton_from_pool`, delegate `build_request_skeleton`.
- Modify `crates/handshaker-core/src/grpc/mod.rs` — export `build_request_skeleton_from_pool`.

**src-tauri:**
- Create `src-tauri/src/ipc/target.rs` — `GrpcTargetIpc { address, tls, skip_verify }` DTO + `into_core()` (validates via `GrpcTarget::new`).
- Modify `src-tauri/src/ipc/mod.rs` — `pub mod target; pub use target::GrpcTargetIpc;`.
- Modify `src-tauri/src/commands/grpc.rs` — remove `grpc_connect`/`grpc_disconnect`/`grpc_invoke_unary` + `ConnectInput`/`ConnectOutcome`; add `grpc_describe`/`grpc_invoke_oneshot`; retarget `grpc_refresh_contract`/`grpc_build_request_skeleton`.
- Modify `src-tauri/src/commands/events.rs` — remove `ConnectionStateChanged` + `TargetSummary` (no longer referenced).
- Modify `src-tauri/src/state.rs` — remove the `connection` slot.
- Modify `src-tauri/src/lib.rs` — `collect_commands!` (remove 3, add 2), `collect_events!` (remove `ConnectionStateChanged`).

**Frontend:**
- Create `src/lib/ids.ts` — dependency-free UUID v7 `newId()`.
- Create `src/features/collections/useCollections.ts` — collections data-layer hook.
- Create `src/features/collections/draft.ts` — `DraftRequest` type + mapping helpers.
- Create `src/features/collections/SaveRequestDialog.tsx` — Save dialog.
- Modify `src/ipc/client.ts` — remove old wrappers; add `grpcDescribe`/`grpcInvokeOneshot`; retarget `grpcRefreshContract`/`grpcBuildRequestSkeleton`.
- Modify `src/ipc/events.ts` — remove `onConnectionStateChanged`.
- Modify `src/features/shell/ConnectionBar.tsx` — remove Connect/Disconnect; add refresh + auto-reflect.
- Modify `src/features/invoke/RequestPanel.tsx` — oneshot send; skeleton via target; dirty + Save trigger.
- Modify `src/App.tsx` — drop connection lifecycle; wire draft + describe + Save + dirty-guard.
- Delete `src/features/shell/DisconnectedHero.tsx`.
- Regenerate `src/ipc/bindings.ts` (via `cargo run -p handshaker --bin export-bindings`).

**Decisions made during planning (documented assumptions):**
- **UUID v7 is hand-rolled** in `src/lib/ids.ts` (no `uuid` npm dependency). `parse_item_id`/`parse_collection_id` use `Uuid::parse_str`, which accepts any valid UUID; a small dependency-free v7 generator keeps the build offline-safe and ids sortable. (Spec §7.1 suggested the `uuid` package; this is an equivalent, lighter choice.)
- **IPC target type is `GrpcTargetIpc`** (a specta DTO in the shell), because core `GrpcTarget` does not derive `specta::Type` and core must stay specta-free. It serializes identically: `{ address, tls, skip_verify }`.
- **`IpcError::NotConnected`** stays in the enum (unused) — removing it is out of scope and harmless.

---

## Task 1: Core — pool-based skeleton builder

**Files:**
- Modify: `crates/handshaker-core/src/grpc/invoke/mod.rs`
- Modify: `crates/handshaker-core/src/grpc/mod.rs`

- [ ] **Step 1: Add the failing tests** in `invoke/mod.rs`'s `mod tests` (reuses the existing `fixture_pool()`), placed just before `async fn unknown_service_returns_service_not_found`:

```rust
    #[test]
    fn skeleton_from_pool_builds_for_known_method() {
        let pool = fixture_pool();
        let s = build_request_skeleton_from_pool(&pool, "test.Echo", "Send").expect("skeleton");
        assert!(s.contains("\"id\""), "got {s}");
    }

    #[test]
    fn skeleton_from_pool_unknown_service_errors() {
        let pool = fixture_pool();
        let err = build_request_skeleton_from_pool(&pool, "no.Such", "Send").unwrap_err();
        assert!(matches!(err, CoreError::ServiceNotFound { .. }), "got {err:?}");
    }
```

- [ ] **Step 2: Run — verify it fails to compile** (function not defined):

Run: `cargo test -p handshaker-core --lib grpc::invoke`
Expected: FAIL — `cannot find function build_request_skeleton_from_pool`.

- [ ] **Step 3: Refactor `build_request_skeleton`** (lines 36–57) into a pool-based fn + delegate:

```rust
/// Build a JSON skeleton for the request body of the given method.
///
/// Used by the UI when the user clicks a method in the catalog — populates the request
/// body editor with default values.
pub fn build_request_skeleton(
    connection: &GrpcConnection,
    service: &str,
    method: &str,
) -> Result<String, CoreError> {
    build_request_skeleton_from_pool(&connection.pool, service, method)
}

/// Build a pretty-printed JSON skeleton for a method's input message, from a pool.
///
/// Pool-based variant so callers without a live `GrpcConnection` (e.g. the lazy
/// connect-on-Send command surface) can build a skeleton straight from a cached
/// descriptor pool.
pub fn build_request_skeleton_from_pool(
    pool: &prost_reflect::DescriptorPool,
    service: &str,
    method: &str,
) -> Result<String, CoreError> {
    let svc = pool
        .get_service_by_name(service)
        .ok_or_else(|| CoreError::ServiceNotFound {
            service: service.to_string(),
        })?;
    let m = svc
        .methods()
        .find(|m| m.name() == method)
        .ok_or_else(|| CoreError::MethodNotFound {
            service: service.to_string(),
            method: method.to_string(),
        })?;
    let input_desc = m.input();
    let value = skeleton::build_default_json_skeleton(&input_desc);
    serde_json::to_string_pretty(&value).map_err(|e| CoreError::EncodeRequest(e.to_string()))
}
```

- [ ] **Step 4: Export it** from `crates/handshaker-core/src/grpc/mod.rs` (line 23):

```rust
pub use invoke::{
    build_request_skeleton, build_request_skeleton_from_pool, invoke_unary, UnaryOutcome,
};
```

- [ ] **Step 5: Run — verify PASS.**

Run: `cargo test -p handshaker-core --lib grpc::invoke`
Expected: PASS (existing invoke tests + 2 new).

- [ ] **Step 6: Commit.**

```bash
git add crates/handshaker-core/src/grpc/invoke/mod.rs crates/handshaker-core/src/grpc/mod.rs
git commit -m "feat(core): pool-based build_request_skeleton_from_pool"
```

---

## Task 2: src-tauri — `GrpcTargetIpc` DTO + target-based commands

This is one task because the DTO, command rewrite, state, events, and registration must compile together.

**Files:**
- Create: `src-tauri/src/ipc/target.rs`
- Modify: `src-tauri/src/ipc/mod.rs`
- Modify: `src-tauri/src/commands/grpc.rs`
- Modify: `src-tauri/src/commands/events.rs`
- Modify: `src-tauri/src/state.rs`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Create `src-tauri/src/ipc/target.rs`.**

```rust
//! IPC target DTO. handshaker-core's `GrpcTarget` stays specta-free, so the
//! shell owns the specta-typed boundary type. `into_core` validates via
//! `GrpcTarget::new` (struct-literal / `Deserialize` construction bypasses
//! validation, so untrusted IPC payloads must route through it).

use handshaker_core::error::CoreError;
use handshaker_core::grpc::GrpcTarget;
use serde::{Deserialize, Serialize};
use specta::Type;

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct GrpcTargetIpc {
    pub address: String,
    pub tls: bool,
    pub skip_verify: bool,
}

impl GrpcTargetIpc {
    /// Validate + convert to the core target. A bad `address` maps to
    /// `CoreError::InvalidTarget` → `IpcError::InvalidTarget`.
    pub fn into_core(self) -> Result<GrpcTarget, CoreError> {
        GrpcTarget::new(self.address, self.tls, self.skip_verify)
    }
}
```

- [ ] **Step 2: Wire into `src-tauri/src/ipc/mod.rs`.** Add `pub mod target;` to the module list and `pub use target::GrpcTargetIpc;` to the re-exports.

- [ ] **Step 3: Replace `src-tauri/src/commands/grpc.rs`** with the full target-based surface:

```rust
//! gRPC commands — thin wrappers around `handshaker_core::grpc::*`. NO business logic.
//!
//! Lazy connect-on-Send model (plan-06b): no held connection. The `ContractCache`
//! holds pools/catalogs between calls; a `GrpcConnection` lives only for the duration
//! of one `grpc_invoke_oneshot` (or a `grpc_describe` cache miss) and is dropped after.

use std::sync::Arc;

use handshaker_core::grpc::{
    activate, build_request_skeleton_from_pool, invoke_unary, ContractKey, GrpcTarget,
    TonicTransport,
};
use tauri::{AppHandle, State};
use tauri_specta::Event;

use crate::commands::events::ContractUpdated;
use crate::ipc::{GrpcTargetIpc, InvokeOutcomeIpc, InvokeRequest, IpcError, ServiceCatalogIpc};
use crate::state::AppState;

fn target_key(t: &GrpcTarget) -> String {
    format!("{}|tls={}|skip_verify={}", t.address, t.tls, t.skip_verify)
}

/// Cache-first contract describe. On a cache hit, returns the cached catalog
/// WITHOUT opening a channel (auto-reflect-on-blur fires often). On a miss,
/// `activate()` reflects + populates the cache, then the connection is dropped.
#[tauri::command]
#[specta::specta]
pub async fn grpc_describe(
    app: AppHandle,
    state: State<'_, AppState>,
    target: GrpcTargetIpc,
) -> Result<ServiceCatalogIpc, IpcError> {
    let target = target.into_core()?;
    let key = ContractKey::from_target(&target);

    if let Some(cached) = state.contract_cache.get(&key) {
        return Ok(cached.catalog.into());
    }

    let transport = Arc::new(TonicTransport::new());
    let conn = activate(target, transport, state.contract_cache.as_ref()).await?;
    let catalog: ServiceCatalogIpc = conn.catalog.clone().into();
    ContractUpdated { target_key: target_key(&conn.target) }
        .emit(&app)
        .ok();
    Ok(catalog)
    // conn dropped here.
}

/// Manual refresh: invalidate the cache entry then re-reflect.
#[tauri::command]
#[specta::specta]
pub async fn grpc_refresh_contract(
    app: AppHandle,
    state: State<'_, AppState>,
    target: GrpcTargetIpc,
) -> Result<ServiceCatalogIpc, IpcError> {
    let target = target.into_core()?;
    state
        .contract_cache
        .invalidate(&ContractKey::from_target(&target));
    let transport = Arc::new(TonicTransport::new());
    let conn = activate(target, transport, state.contract_cache.as_ref()).await?;
    let catalog: ServiceCatalogIpc = conn.catalog.clone().into();
    ContractUpdated { target_key: target_key(&conn.target) }
        .emit(&app)
        .ok();
    Ok(catalog)
}

/// Build a JSON skeleton from the cached pool. On a cache miss, activate first.
#[tauri::command]
#[specta::specta]
pub async fn grpc_build_request_skeleton(
    state: State<'_, AppState>,
    target: GrpcTargetIpc,
    service: String,
    method: String,
) -> Result<String, IpcError> {
    let target = target.into_core()?;
    let key = ContractKey::from_target(&target);

    if let Some(cached) = state.contract_cache.get(&key) {
        return Ok(build_request_skeleton_from_pool(&cached.pool, &service, &method)?);
    }
    let transport = Arc::new(TonicTransport::new());
    let conn = activate(target, transport, state.contract_cache.as_ref()).await?;
    Ok(build_request_skeleton_from_pool(&conn.pool, &service, &method)?)
}

/// One-shot unary invoke: activate (channel required) → invoke → drop.
///
/// Non-OK gRPC status arrives in `InvokeOutcomeIpc.status_code`, NOT as `Err`.
/// `Err` is only for client-side failures (transport / encode / decode).
#[tauri::command]
#[specta::specta]
pub async fn grpc_invoke_oneshot(
    state: State<'_, AppState>,
    target: GrpcTargetIpc,
    request: InvokeRequest,
) -> Result<InvokeOutcomeIpc, IpcError> {
    let target = target.into_core()?;
    let transport = Arc::new(TonicTransport::new());
    let conn = activate(target, transport, state.contract_cache.as_ref()).await?;
    let outcome = invoke_unary(
        &conn,
        &request.service,
        &request.method,
        &request.request_json,
        request.metadata,
    )
    .await?;
    Ok(outcome.into())
    // conn dropped here.
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn target_key_is_stable_for_equivalent_target() {
        let a = GrpcTarget::new("api.prod:8443", true, false).unwrap();
        let b = GrpcTarget::new("api.prod:8443", true, false).unwrap();
        assert_eq!(target_key(&a), target_key(&b));
    }

    #[test]
    fn target_key_differs_on_tls_flag() {
        let a = GrpcTarget::new("api.prod:8443", true, false).unwrap();
        let b = GrpcTarget::new("api.prod:8443", false, false).unwrap();
        assert_ne!(target_key(&a), target_key(&b));
    }
}
```

- [ ] **Step 4: Replace `src-tauri/src/commands/events.rs`** — drop `ConnectionStateChanged` + `TargetSummary`:

```rust
//! Tauri-specta events emitted by the gRPC subsystem.

use serde::{Deserialize, Serialize};
use specta::Type;
use tauri_specta::Event;

/// Emitted whenever a target's contract has been (re)built (describe / refresh).
#[derive(Debug, Clone, Serialize, Deserialize, Type, Event)]
pub struct ContractUpdated {
    /// Stable key identifying the target whose contract just refreshed.
    pub target_key: String,
}
```

- [ ] **Step 5: Edit `src-tauri/src/state.rs`** — remove the held connection.
  - Change the imports: `use handshaker_core::grpc::{ContractCache, InMemoryContractCache};` (drop `GrpcConnection`), and `use tokio::sync::RwLock;` (drop `Mutex`).
  - Remove from the struct:
    ```rust
        /// At most one active gRPC connection per spec §4.
        pub connection: Mutex<Option<Arc<GrpcConnection>>>,
    ```
  - Remove `connection: Mutex::new(None),` from both `Default::default()` and `with_data_dir()`.

- [ ] **Step 6: Edit `src-tauri/src/lib.rs`.**
  - Events import (line 13): `use commands::events::ContractUpdated;`
  - grpc import block (lines 14–17):
    ```rust
    use commands::grpc::{
        grpc_build_request_skeleton, grpc_describe, grpc_invoke_oneshot, grpc_refresh_contract,
    };
    ```
  - In `collect_commands!`, replace the five old grpc entries (`grpc_connect, grpc_disconnect, grpc_refresh_contract, grpc_invoke_unary, grpc_build_request_skeleton`) with:
    ```rust
            grpc_describe,
            grpc_refresh_contract,
            grpc_build_request_skeleton,
            grpc_invoke_oneshot,
    ```
  - Change the events macro: `.events(collect_events![ContractUpdated])`.

- [ ] **Step 7: Build.** (`dist/` already exists in this worktree, so `tauri::generate_context!` will succeed.)

Run: `cargo build -p handshaker`
Expected: clean compile. Fix any unused-import warnings in the touched files (e.g. leftover `Serialize`/`TargetSummary` references).

- [ ] **Step 8: Test.**

Run: `cargo test --workspace`
Expected: PASS (ignored live tests skipped).

- [ ] **Step 9: Commit.**

```bash
git add src-tauri/src/ipc/target.rs src-tauri/src/ipc/mod.rs src-tauri/src/commands/grpc.rs src-tauri/src/commands/events.rs src-tauri/src/state.rs src-tauri/src/lib.rs
git commit -m "refactor(grpc): target-based commands, drop held connection (plan-06b)"
```

---

## Task 3: Regenerate bindings

**Files:**
- Modify (generated): `src/ipc/bindings.ts`

- [ ] **Step 1: Regenerate.**

Run: `cargo run -p handshaker --bin export-bindings`
Expected: prints `wrote .../src/ipc/bindings.ts`.

- [ ] **Step 2: Verify** `src/ipc/bindings.ts` contains:
  - `grpcDescribe(target: GrpcTargetIpc)`, `grpcInvokeOneshot(target, request)`, `grpcRefreshContract(target)`, `grpcBuildRequestSkeleton(target, service, method)`.
  - a `GrpcTargetIpc` type `{ address: string; tls: boolean; skip_verify: boolean }`.
  - NO `grpcConnect`/`grpcDisconnect`/`grpcInvokeUnary`/`ConnectInput`/`ConnectOutcome`/`ConnectionStateChanged`/`TargetSummary`.
  - `events` map has only `contractUpdated`.

- [ ] **Step 3: Commit.**

```bash
git add src/ipc/bindings.ts
git commit -m "chore(ipc): regenerate bindings for target-based commands"
```

---

## Task 4: Frontend `ids.ts` (UUID v7)

**Files:**
- Create: `src/lib/ids.ts`

- [ ] **Step 1: Create the generator.**

```ts
// Dependency-free UUID v7 (time-ordered, RFC 9562). The backend parses ids via
// `Uuid::parse_str`, which accepts any valid UUID; v7 keeps ids sortable.
// (Plan-06b: chosen over the `uuid` npm package to keep the build offline-safe.)

function randomBytes(n: number): Uint8Array {
  const b = new Uint8Array(n);
  crypto.getRandomValues(b);
  return b;
}

/** Generate a UUID v7 string. */
export function newId(): string {
  const ts = Date.now(); // ms since epoch (48-bit)
  const bytes = randomBytes(16);
  bytes[0] = Math.floor(ts / 2 ** 40) & 0xff;
  bytes[1] = Math.floor(ts / 2 ** 32) & 0xff;
  bytes[2] = Math.floor(ts / 2 ** 24) & 0xff;
  bytes[3] = Math.floor(ts / 2 ** 16) & 0xff;
  bytes[4] = Math.floor(ts / 2 ** 8) & 0xff;
  bytes[5] = ts & 0xff;
  bytes[6] = (bytes[6] & 0x0f) | 0x70; // version 7
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant 10xx
  const hex = Array.from(bytes, (x) => x.toString(16).padStart(2, "0"));
  return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex
    .slice(6, 8)
    .join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10, 16).join("")}`;
}
```

- [ ] **Step 2: Sanity-check the format** (manual, no Vitest in repo): the pattern is `8-4-4-4-12` hex with the 13th hex digit `7`. Confirmed by reading the code. Commit happens with Task 8 (first consumer compiles it).

---

## Task 5: Frontend IPC client + events

**Files:**
- Modify: `src/ipc/client.ts`
- Modify: `src/ipc/events.ts`

- [ ] **Step 1: `client.ts` imports** — in the `import type { ... }` block, remove `ConnectInput`, `ConnectOutcome`; add `GrpcTargetIpc`.

- [ ] **Step 2: Replace the four gRPC wrappers** (`grpcConnect`, `grpcDisconnect`, `grpcRefreshContract`, `grpcInvokeUnary`, `grpcBuildRequestSkeleton`) with:

```ts
export async function grpcDescribe(target: GrpcTargetIpc): Promise<ServiceCatalogIpc> {
  const r = await commands.grpcDescribe(target);
  if (r.status === "error") throw r.error;
  return r.data;
}

export async function grpcRefreshContract(target: GrpcTargetIpc): Promise<ServiceCatalogIpc> {
  const r = await commands.grpcRefreshContract(target);
  if (r.status === "error") throw r.error;
  return r.data;
}

export async function grpcBuildRequestSkeleton(
  target: GrpcTargetIpc,
  service: string,
  method: string,
): Promise<string> {
  const r = await commands.grpcBuildRequestSkeleton(target, service, method);
  if (r.status === "error") throw r.error;
  return r.data;
}

export async function grpcInvokeOneshot(
  target: GrpcTargetIpc,
  req: InvokeRequest,
): Promise<InvokeOutcomeIpc> {
  const r = await commands.grpcInvokeOneshot(target, req);
  if (r.status === "error") throw r.error;
  return r.data;
}
```

- [ ] **Step 3: Update the `ipc` export object** — remove `grpcConnect`, `grpcDisconnect`, `grpcInvokeUnary`; add `grpcDescribe`, `grpcInvokeOneshot`; keep `grpcRefreshContract`, `grpcBuildRequestSkeleton`.

- [ ] **Step 4: `events.ts`** — remove `onConnectionStateChanged` and the `ConnectionStateChanged` import; keep `onContractUpdated`:

```ts
import { events } from "./bindings";
import type { ContractUpdated } from "./bindings";

/** Subscribe to backend events. Returns an unlisten function. */
export function onContractUpdated(
  handler: (e: ContractUpdated) => void,
): Promise<() => void> {
  return events.contractUpdated.listen((evt) => handler(evt.payload));
}
```

- [ ] **Step 5:** Don't lint yet (App.tsx still references removed APIs). Commit happens with Task 9.

---

## Task 6: Frontend draft model

**Files:**
- Create: `src/features/collections/draft.ts`

- [ ] **Step 1: Create the draft type + mapping helpers.**

```ts
import { AUTH_DEFAULTS, type AuthState } from "@/features/invoke/AuthInline";
import type { MetadataRow } from "@/features/invoke/MetadataView";
import type { MethodKind } from "@/features/shell/SelectedMethod";
import type { ItemIpc, SavedRequestIpc } from "@/ipc/bindings";

export interface DraftOrigin {
  collectionId: string;
  itemId: string;
}

export interface DraftRequest {
  address: string; // template, may contain {{var}}
  tls: boolean;
  skipVerify: boolean; // always false in #2
  service: string | null;
  method: string | null;
  kind: MethodKind | null;
  body: string; // JSON template
  metadata: MetadataRow[];
  auth: AuthState; // inline (none/bearer) — send-time only
  origin: DraftOrigin | null;
  dirty: boolean;
}

export function emptyDraft(address = "localhost:5002"): DraftRequest {
  return {
    address,
    tls: false,
    skipVerify: false,
    service: null,
    method: null,
    kind: null,
    body: "{}",
    metadata: [],
    auth: AUTH_DEFAULTS,
    origin: null,
    dirty: false,
  };
}

/** Build a `SavedRequestIpc` from the draft. `auth_by_env` is empty (decision #4). */
export function draftToSavedRequest(
  draft: DraftRequest,
  name: string,
  id: string,
): SavedRequestIpc {
  const metadata: Record<string, string> = {};
  for (const r of draft.metadata) if (r.k.trim()) metadata[r.k.trim()] = r.v;
  return {
    id,
    name,
    address_template: draft.address,
    service: draft.service ?? "",
    method: draft.method ?? "",
    body_template: draft.body,
    metadata,
    auth_by_env: { configs: {} },
    tls_override: draft.tls,
  };
}

/** Wrap a SavedRequest as a request `ItemIpc`. */
export function savedRequestItem(saved: SavedRequestIpc): ItemIpc {
  return { type: "request", ...saved };
}

/** Replace a request node (by id) inside an item tree, returning a new tree. */
export function replaceRequestInItems(
  items: ItemIpc[],
  itemId: string,
  next: SavedRequestIpc,
): ItemIpc[] {
  return items.map((it) => {
    if (it.type === "request" && it.id === itemId) return { type: "request", ...next };
    if (it.type === "folder") {
      return { type: "folder", ...it, items: replaceRequestInItems(it.items, itemId, next) };
    }
    return it;
  });
}

/** Populate a draft from a saved request (inline auth resets to none in #2). */
export function loadIntoDraft(saved: SavedRequestIpc, origin: DraftOrigin): DraftRequest {
  return {
    address: saved.address_template,
    tls: saved.tls_override ?? false,
    skipVerify: false,
    service: saved.service || null,
    method: saved.method || null,
    kind: null, // resolved from catalog after describe
    body: saved.body_template,
    metadata: Object.entries(saved.metadata ?? {}).map(([k, v]) => ({ k, v: v ?? "" })),
    auth: AUTH_DEFAULTS,
    origin,
    dirty: false,
  };
}
```

- [ ] **Step 2:** Commit with Task 9.

---

## Task 7: Frontend `useCollections` hook

**Files:**
- Create: `src/features/collections/useCollections.ts`

- [ ] **Step 1: Create the hook** (refetch-on-mutate, no events — mirrors the env-dialog pattern):

```ts
import { useCallback, useEffect, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { ipc } from "@/ipc/client";
import { newId } from "@/lib/ids";
import type { CollectionIpc, CollectionMetaIpc, ItemIpc } from "@/ipc/bindings";

export interface UseCollections {
  metas: CollectionMetaIpc[];
  byId: Record<string, CollectionIpc>;
  loading: boolean;
  error: string | null;
  refreshList: () => Promise<void>;
  load: (id: string) => Promise<CollectionIpc>;
  createCollection: (name: string) => Promise<string>;
  addRequest: (collectionId: string, parentId: string | null, item: ItemIpc) => Promise<void>;
  upsert: (collection: CollectionIpc) => Promise<void>;
}

function tag(e: unknown): string {
  const t = e as { type?: string; message?: string };
  return t.message ?? t.type ?? "collection error";
}

export function useCollections(): UseCollections {
  const [metas, setMetas] = useState<CollectionMetaIpc[]>([]);
  const [byId, setById] = useState<Record<string, CollectionIpc>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refreshList = useCallback(async () => {
    setLoading(true);
    try {
      setMetas(await ipc.collectionList());
      setError(null);
    } catch (e) {
      setError(tag(e));
    } finally {
      setLoading(false);
    }
  }, []);

  const load = useCallback(async (id: string) => {
    const c = await ipc.collectionGet(id);
    setById((m) => ({ ...m, [id]: c }));
    return c;
  }, []);

  const createCollection = useCallback(
    async (name: string) => {
      const id = newId();
      const collection: CollectionIpc = {
        id,
        name,
        items: [],
        variables: {},
        auth_by_env: { configs: {} },
        default_tls: false,
        skip_tls_verify: false,
      };
      await ipc.collectionUpsert(collection);
      setById((m) => ({ ...m, [id]: collection }));
      await refreshList();
      return id;
    },
    [refreshList],
  );

  const addRequest = useCallback(
    async (collectionId: string, parentId: string | null, item: ItemIpc) => {
      await ipc.collectionAddItem(collectionId, parentId, item);
      await load(collectionId);
    },
    [load],
  );

  const upsert = useCallback(
    async (collection: CollectionIpc) => {
      await ipc.collectionUpsert(collection);
      setById((m) => ({ ...m, [collection.id]: collection }));
      await refreshList();
    },
    [refreshList],
  );

  useEffect(() => {
    if (!isTauri()) return;
    refreshList().catch(() => undefined);
  }, [refreshList]);

  return { metas, byId, loading, error, refreshList, load, createCollection, addRequest, upsert };
}
```

- [ ] **Step 2:** Commit with Task 9.

---

## Task 8: ConnectionBar — auto-reflect, no Connect/Disconnect

**Files:**
- Modify: `src/features/shell/ConnectionBar.tsx`

- [ ] **Step 1: Replace the file** with the lazy-model address bar. Layout `[TLS] [ address │ "/" │ picker ] [↻] [Send]`, `h-14`, controls `h-9`:

```tsx
import { Lock, RefreshCw, Send, Unlock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/cn";
import type { SelectedMethod } from "./SelectedMethod";

export interface ConnectionBarProps {
  host: string;
  onHostChange: (next: string) => void;
  onHostCommit: () => void; // fires on blur / Enter — triggers describe
  tls: boolean;
  onTlsChange: (next: boolean) => void;
  sending: boolean;
  selected: SelectedMethod | null;
  onSend: () => void;
  onRefresh: () => void;
  refreshing: boolean;
  reflectNote: string | null;
  pickerSlot?: React.ReactNode;
}

export function ConnectionBar({
  host,
  onHostChange,
  onHostCommit,
  tls,
  onTlsChange,
  sending,
  selected,
  onSend,
  onRefresh,
  refreshing,
  reflectNote,
  pickerSlot,
}: ConnectionBarProps) {
  return (
    <div className="flex-none border-b border-border bg-background relative z-10">
      <div className="h-14 flex items-center gap-2 px-3.5">
        <Tooltip content={tls ? "TLS enabled — click to switch to plaintext" : "Plaintext — click to enable TLS"}>
          <Button
            variant="outline"
            size="icon"
            onClick={() => onTlsChange(!tls)}
            aria-label={tls ? "TLS enabled" : "Plaintext"}
            className="h-9 w-9 flex-none"
          >
            {tls ? <Lock className="size-3.5" /> : <Unlock className="size-3.5" />}
          </Button>
        </Tooltip>
        <div className="flex-1 min-w-0 flex items-stretch h-9 rounded-md border border-input bg-background focus-within:ring-1 focus-within:ring-ring">
          <Input
            value={host}
            onChange={(e) => onHostChange(e.target.value)}
            onBlur={onHostCommit}
            onKeyDown={(e) => {
              if (e.key === "Enter") onHostCommit();
            }}
            placeholder="host:port"
            className={cn(
              "w-[44%] min-w-[140px] h-full px-3 bg-transparent font-mono text-[12.5px]",
              "border-0 shadow-none focus-visible:ring-0 focus-visible:ring-offset-0 rounded-l-md rounded-r-none",
            )}
          />
          <span className="w-px self-stretch bg-border my-1.5" />
          <div className="flex-1 min-w-0 flex items-center pl-2 pr-1.5">
            <span className="text-muted-foreground/60 font-mono text-xs select-none mr-0.5">/</span>
            {pickerSlot ?? (
              <span className="font-mono text-[11.5px] text-muted-foreground/70 select-none truncate">
                {host ? "no methods — check the address" : "enter a host to discover methods"}
              </span>
            )}
          </div>
        </div>
        <Tooltip content="Refresh contract">
          <Button
            variant="ghost"
            size="icon"
            onClick={onRefresh}
            disabled={!host || refreshing}
            aria-label="Refresh contract"
            className="h-9 w-9 flex-none text-muted-foreground hover:text-foreground"
          >
            <RefreshCw className={cn("size-3.5", refreshing && "animate-spin")} />
          </Button>
        </Tooltip>
        <Button onClick={onSend} disabled={sending || !selected} className="h-9 flex-none gap-1.5 min-w-[88px]">
          {sending ? (
            <>
              <span className="spinner" /> Sending
            </>
          ) : (
            <>
              <Send className="size-3" /> Send
            </>
          )}
        </Button>
      </div>
      {reflectNote && (
        <div className="px-3.5 pb-1.5 -mt-1 text-[11px] text-muted-foreground font-mono truncate">{reflectNote}</div>
      )}
    </div>
  );
}
```

- [ ] **Step 2:** Commit with Task 9.

---

## Task 9: RequestPanel + SaveRequestDialog + App.tsx integration

This is the integration task: it removes the connection model end-to-end and makes the frontend lint green. Implement steps in order; lint once at the end.

**Files:**
- Modify: `src/features/invoke/RequestPanel.tsx`
- Create: `src/features/collections/SaveRequestDialog.tsx`
- Modify: `src/App.tsx`
- Delete: `src/features/shell/DisconnectedHero.tsx`

- [ ] **Step 1: `RequestPanel.tsx`** — accept `target` + `onDirty` + `onRequestSave`; use oneshot.

  - Imports: add `import type { GrpcTargetIpc } from "@/ipc/bindings";` and `import { Save } from "lucide-react";`.
  - Extend `RequestPanelProps`:
    ```ts
    target: GrpcTargetIpc;
    onDirty: () => void;
    onRequestSave: () => void;
    ```
  - Destructure them in the component body.
  - Skeleton effect: change the call to
    ```ts
    const skeleton = await ipc.grpcBuildRequestSkeleton(target, selected.service, selected.method);
    ```
    and add `target.address`, `target.tls` to the effect dep array (so a re-describe / address change reloads the skeleton).
  - `useImperativeHandle(ref, () => ({ send }), [body, metadata, auth, selected, target]);`
  - In `send()`, resolve the address and call oneshot. After the existing `meta` building block and before `onSending(true)`, insert address resolution:
    ```ts
    let resolvedAddr: string;
    try {
      const ar = await ipc.varsResolve(target.address);
      if (ar.unresolved_vars.length > 0) {
        onError(`Address has unresolved vars: ${ar.unresolved_vars.join(", ")}`);
        return;
      }
      if (ar.cycle_chain) {
        onError(`Address cycle: ${ar.cycle_chain.join(" → ")}`);
        return;
      }
      resolvedAddr = ar.resolved;
    } catch (e) {
      const t = e as { type?: string; message?: string };
      onError(t.message ?? t.type ?? "resolve failed");
      return;
    }
    ```
    Replace the `ipc.grpcInvokeUnary({...})` call with:
    ```ts
    const outcome = await ipc.grpcInvokeOneshot(
      { address: resolvedAddr, tls: target.tls, skip_verify: false },
      {
        service: selected.service,
        method: selected.method,
        request_json: resolved,
        metadata: meta,
      },
    );
    ```
  - Mark dirty on edits: wrap the body/metadata/auth handlers. Change:
    - `<BodyEditor value={body} onChange={setBody} />` →
      ```tsx
      <BodyEditor value={body} onChange={(v) => { onDirty(); setBody(v); }} />
      ```
    - `<MetadataView rows={metadata} onChange={onMetadataChange} />` →
      ```tsx
      <MetadataView rows={metadata} onChange={(next) => { onDirty(); onMetadataChange(next); }} />
      ```
    - `<AuthInline value={auth} onChange={onAuthChange} />` →
      ```tsx
      <AuthInline value={auth} onChange={(next) => { onDirty(); onAuthChange(next); }} />
      ```
  - Add a Save button to the head action group (`ml-auto` div), before the Beautify tooltip:
    ```tsx
    <Tooltip content="Save request">
      <Button type="button" variant="ghost" size="icon-sm" onClick={onRequestSave}>
        <Save className="size-3.5" />
      </Button>
    </Tooltip>
    ```

- [ ] **Step 2: Create `src/features/collections/SaveRequestDialog.tsx`.**

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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { CollectionIpc, CollectionMetaIpc, FolderIpc } from "@/ipc/bindings";

export interface SaveRequestDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  metas: CollectionMetaIpc[];
  loadCollection: (id: string) => Promise<CollectionIpc>;
  defaultName: string;
  onSave: (args: { collectionId: string; parentId: string | null; name: string }) => Promise<void>;
  onCreateCollection: (name: string) => Promise<string>;
}

export function SaveRequestDialog(props: SaveRequestDialogProps) {
  const { open, onOpenChange, metas, loadCollection, defaultName, onSave, onCreateCollection } = props;
  const [name, setName] = useState(defaultName);
  const [collectionId, setCollectionId] = useState<string>("");
  const [parentId, setParentId] = useState<string | null>(null);
  const [folders, setFolders] = useState<FolderIpc[]>([]);
  const [newColName, setNewColName] = useState("");
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setName(defaultName);
      setCreating(metas.length === 0);
    }
  }, [open, defaultName, metas.length]);

  useEffect(() => {
    if (!collectionId && metas.length > 0) setCollectionId(metas[0].id);
  }, [metas, collectionId]);

  useEffect(() => {
    let cancelled = false;
    if (!collectionId) {
      setFolders([]);
      return;
    }
    loadCollection(collectionId)
      .then((c) => {
        if (cancelled) return;
        const fs = c.items.filter((i) => i.type === "folder") as Array<{ type: "folder" } & FolderIpc>;
        setFolders(fs);
        setParentId(null);
      })
      .catch(() => setFolders([]));
    return () => {
      cancelled = true;
    };
  }, [collectionId, loadCollection]);

  async function submit() {
    if (!name.trim()) return;
    setBusy(true);
    try {
      let cid = collectionId;
      if (creating) {
        if (!newColName.trim()) return;
        cid = await onCreateCollection(newColName.trim());
      }
      if (!cid) return;
      await onSave({ collectionId: cid, parentId, name: name.trim() });
      onOpenChange(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[460px]">
        <DialogHeader>
          <DialogTitle>Save request</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4 py-1">
          <div className="grid gap-1.5">
            <Label className="text-xs">Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="My request" autoFocus />
          </div>
          <div className="grid gap-1.5">
            <Label className="text-xs">Collection</Label>
            {creating ? (
              <Input
                value={newColName}
                onChange={(e) => setNewColName(e.target.value)}
                placeholder="New collection name"
              />
            ) : (
              <select
                value={collectionId}
                onChange={(e) => setCollectionId(e.target.value)}
                className="h-9 px-3 rounded-md border border-input bg-background text-sm"
              >
                {metas.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            )}
            <button
              type="button"
              className="text-[11px] text-muted-foreground hover:text-foreground text-left"
              onClick={() => setCreating((v) => !v)}
            >
              {creating ? (metas.length ? "← choose existing collection" : "") : "+ New collection"}
            </button>
          </div>
          {!creating && folders.length > 0 && (
            <div className="grid gap-1.5">
              <Label className="text-xs">Folder (optional)</Label>
              <select
                value={parentId ?? ""}
                onChange={(e) => setParentId(e.target.value || null)}
                className="h-9 px-3 rounded-md border border-input bg-background text-sm"
              >
                <option value="">Collection root</option>
                {folders.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={busy}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 3: Rewrite `src/App.tsx`.** Full replacement:

```tsx
import { useEffect, useRef, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { EnvPill } from "@/features/envs/EnvPill";
import { Titlebar } from "@/features/shell/Titlebar";
import { Toolbar } from "@/features/shell/Toolbar";
import { Sidebar, type SidebarTab } from "@/features/shell/Sidebar";
import { ConnectionBar } from "@/features/shell/ConnectionBar";
import { MethodPicker } from "@/features/shell/MethodPicker";
import { SidebarServicesPane } from "@/features/shell/SidebarServicesPane";
import { SidebarHistoryPane } from "@/features/shell/SidebarHistoryPane";
import { SidebarCollectionsPane } from "@/features/shell/SidebarCollectionsPane";
import { RequestPanel, type RequestPanelHandle } from "@/features/invoke/RequestPanel";
import type { MetadataRow } from "@/features/invoke/MetadataView";
import { type AuthState } from "@/features/invoke/AuthInline";
import { ResponsePanel } from "@/features/response/ResponsePanel";
import type { RespState } from "@/features/response/RespMeta";
import { SettingsDialog } from "@/features/settings/SettingsDialog";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { ipc } from "@/ipc/client";
import type { GrpcTargetIpc, InvokeOutcomeIpc, ServiceCatalogIpc } from "@/ipc/bindings";
import { deriveKind, type SelectedMethod } from "@/features/shell/SelectedMethod";
import { useCollections } from "@/features/collections/useCollections";
import { SaveRequestDialog } from "@/features/collections/SaveRequestDialog";
import {
  draftToSavedRequest,
  emptyDraft,
  replaceRequestInItems,
  savedRequestItem,
  type DraftRequest,
} from "@/features/collections/draft";
import { newId } from "@/lib/ids";
import { usePrefs } from "@/lib/use-prefs";
import { cn } from "@/lib/cn";

export default function App() {
  const [prefs] = usePrefs();
  const [version, setVersion] = useState("");
  const [catalog, setCatalog] = useState<ServiceCatalogIpc | null>(null);
  const [selected, setSelected] = useState<SelectedMethod | null>(null);
  const [activeEnv, setActiveEnv] = useState<string | null>(null);
  const [envs, setEnvs] = useState<import("@/ipc/bindings").EnvironmentIpc[]>([]);
  const [sideTab, setSideTab] = useState<SidebarTab>("services");
  const [sideQuery, setSideQuery] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);

  const [draft, setDraft] = useState<DraftRequest>(emptyDraft());
  const [sending, setSending] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [reflectNote, setReflectNote] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<InvokeOutcomeIpc | null>(null);
  const [invokeError, setInvokeError] = useState<string | null>(null);
  const [saveOpen, setSaveOpen] = useState(false);
  const [guard, setGuard] = useState<{ open: boolean; next: () => void }>({ open: false, next: () => {} });

  const collections = useCollections();
  const envSwitcherTriggerRef = useRef<HTMLButtonElement>(null);
  const mainRef = useRef<HTMLElement>(null);
  const requestPanelRef = useRef<RequestPanelHandle>(null);

  const target: GrpcTargetIpc = { address: draft.address, tls: draft.tls, skip_verify: false };

  // --- theme / density / fonts (unchanged) -------------------------------
  useEffect(() => {
    document.documentElement.classList.toggle("dark", prefs.theme === "dark");
  }, [prefs.theme]);

  useEffect(() => {
    const fs = prefs.density === "compact" ? "12.5px" : prefs.density === "cozy" ? "13.5px" : "13px";
    const root = document.getElementById("root");
    if (root) root.style.fontSize = fs;
    document.documentElement.style.fontSize = "";
    const ui =
      prefs.fontUi === "geist"
        ? `"Geist","Inter",ui-sans-serif,system-ui,sans-serif`
        : prefs.fontUi === "system"
          ? `system-ui,-apple-system,"Segoe UI",sans-serif`
          : `"Inter",ui-sans-serif,system-ui,sans-serif`;
    document.documentElement.style.setProperty("--font-sans-override", ui);
    const mn =
      prefs.fontMono === "geist-mono"
        ? `"Geist Mono","JetBrains Mono",ui-monospace,monospace`
        : prefs.fontMono === "ibm"
          ? `"IBM Plex Mono","JetBrains Mono",ui-monospace,monospace`
          : `"JetBrains Mono",ui-monospace,"SF Mono",Menlo,monospace`;
    document.documentElement.style.setProperty("--font-mono-override", mn);
  }, [prefs.density, prefs.fontUi, prefs.fontMono]);

  useEffect(() => {
    const el = mainRef.current;
    if (!el || !prefs.dots) return;
    function onMove(e: MouseEvent) {
      const r = el!.getBoundingClientRect();
      el!.style.setProperty("--mx", `${((e.clientX - r.left) / r.width) * 100}%`);
      el!.style.setProperty("--my", `${((e.clientY - r.top) / r.height) * 100}%`);
    }
    el.addEventListener("mousemove", onMove);
    return () => el.removeEventListener("mousemove", onMove);
  }, [prefs.dots]);

  useEffect(() => {
    if (!isTauri()) return;
    ipc.appVersion().then(setVersion).catch(console.error);
    ipc.envActiveGet().then(setActiveEnv).catch(console.error);
    ipc.envList().then(setEnvs).catch(console.error);
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!((e.metaKey || e.ctrlKey) && (e.key === "e" || e.key === "E"))) return;
      const t = e.target as HTMLElement | null;
      if (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t?.isContentEditable) return;
      e.preventDefault();
      envSwitcherTriggerRef.current?.click();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // --- describe (cache-first via backend) --------------------------------
  async function describe(address: string, tls: boolean) {
    if (!address.trim()) {
      setCatalog(null);
      setReflectNote(null);
      return;
    }
    let resolved: string;
    try {
      const r = await ipc.varsResolve(address);
      if (r.unresolved_vars.length > 0) {
        setReflectNote(`Unresolved: ${r.unresolved_vars.join(", ")}`);
        setCatalog(null);
        return;
      }
      if (r.cycle_chain) {
        setReflectNote(`Variable cycle: ${r.cycle_chain.join(" → ")}`);
        setCatalog(null);
        return;
      }
      resolved = r.resolved;
    } catch {
      return; // resolve failure is non-fatal; leave picker as-is
    }
    try {
      const cat = await ipc.grpcDescribe({ address: resolved, tls, skip_verify: false });
      setCatalog(cat);
      setReflectNote(null);
    } catch (e) {
      const t = e as { type?: string; message?: string };
      setReflectNote(t.message ?? t.type ?? "reflection failed");
      setCatalog(null);
    }
  }

  // Debounced auto-reflect on address / tls change.
  useEffect(() => {
    if (!isTauri()) return;
    const addr = draft.address;
    const tls = draft.tls;
    const id = setTimeout(() => {
      describe(addr, tls).catch(() => undefined);
    }, 400);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft.address, draft.tls]);

  // Auto-select the first method when a catalog arrives and none is selected.
  useEffect(() => {
    if (!catalog) {
      setSelected(null);
      return;
    }
    if (selected) {
      // keep selection if still present
      const stillThere = catalog.services.some(
        (s) => s.full_name === selected.service && s.methods.some((m) => m.name === selected.method),
      );
      if (stillThere) return;
    }
    const svc = catalog.services[0];
    const mth = svc?.methods[0];
    setSelected(svc && mth ? { service: svc.full_name, method: mth.name, kind: deriveKind(mth) } : null);
  }, [catalog]); // eslint-disable-line react-hooks/exhaustive-deps

  // Reset response + sync draft service/method when selection changes.
  useEffect(() => {
    setOutcome(null);
    setInvokeError(null);
    setDraft((d) => ({
      ...d,
      service: selected?.service ?? null,
      method: selected?.method ?? null,
      kind: selected?.kind ?? null,
    }));
  }, [selected?.service, selected?.method]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Enter" || (!e.ctrlKey && !e.metaKey)) return;
      if (sending || !selected) return;
      e.preventDefault();
      e.stopPropagation();
      handleSend();
    }
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sending, selected]);

  const servicesCount = catalog?.services.length ?? 0;

  function handleSend() {
    requestPanelRef.current?.send().catch((e) => console.error("send failed:", e));
  }

  async function handleRefresh() {
    if (!draft.address.trim()) return;
    setRefreshing(true);
    try {
      const r = await ipc.varsResolve(draft.address);
      if (r.unresolved_vars.length > 0 || r.cycle_chain) {
        setReflectNote("address has unresolved variables");
        return;
      }
      const cat = await ipc.grpcRefreshContract({ address: r.resolved, tls: draft.tls, skip_verify: false });
      setCatalog(cat);
      setReflectNote(null);
    } catch (e) {
      const t = e as { type?: string; message?: string };
      setReflectNote(t.message ?? t.type ?? "refresh failed");
    } finally {
      setRefreshing(false);
    }
  }

  // Replace the draft, prompting Save/Discard/Cancel if dirty.
  function confirmReplaceIfDirty(next: () => void) {
    if (draft.dirty) {
      setGuard({ open: true, next });
    } else {
      next();
    }
  }

  function newDraft() {
    confirmReplaceIfDirty(() => {
      setDraft(emptyDraft(draft.address));
      setOutcome(null);
      setInvokeError(null);
    });
  }

  async function doSave(args: { collectionId: string; parentId: string | null; name: string }) {
    if (draft.origin) {
      // Update in place.
      const col = await collections.load(draft.origin.collectionId);
      const updated = draftToSavedRequest(draft, args.name, draft.origin.itemId);
      const next = { ...col, items: replaceRequestInItems(col.items, draft.origin.itemId, updated) };
      await collections.upsert(next);
      setDraft((d) => ({ ...d, dirty: false }));
    } else {
      const id = newId();
      const saved = draftToSavedRequest(draft, args.name, id);
      await collections.addRequest(args.collectionId, args.parentId, savedRequestItem(saved));
      setDraft((d) => ({ ...d, origin: { collectionId: args.collectionId, itemId: id }, dirty: false }));
    }
  }

  const respState: RespState =
    sending ? "sending" : invokeError ? "error" : outcome ? (outcome.status_code === 0 ? "success" : "error") : "idle";

  return (
    <div className="fixed inset-0 flex flex-col bg-background border border-border rounded-[10px] overflow-hidden">
      <Titlebar />
      <Toolbar
        version={version}
        envSlot={
          <EnvPill
            ref={envSwitcherTriggerRef}
            envs={envs}
            activeEnv={activeEnv}
            onEnvsChanged={async () => setEnvs(await ipc.envList())}
            onActiveEnvChanged={setActiveEnv}
          />
        }
        onOpenSettings={() => setSettingsOpen(true)}
      />
      <div className="flex-1 flex min-h-0">
        {prefs.sidebar && (
          <Sidebar
            tab={sideTab}
            onTabChange={setSideTab}
            query={sideQuery}
            onQueryChange={setSideQuery}
            servicesCount={servicesCount}
            historyCount={0}
          >
            {sideTab === "services" && (
              <SidebarServicesPane
                connected={catalog != null}
                catalog={catalog}
                query={sideQuery}
                selected={selected}
                onSelect={(s) => setSelected(s)}
              />
            )}
            {sideTab === "history" && <SidebarHistoryPane />}
            {sideTab === "saved" && <SidebarCollectionsPane />}
          </Sidebar>
        )}
        <main ref={mainRef} className="flex-1 flex flex-col min-w-0 min-h-0 relative bg-background">
          {prefs.dots && (
            <>
              <div className="dots-base" />
              <div className="dots-glow" />
            </>
          )}
          <ConnectionBar
            host={draft.address}
            onHostChange={(next) => setDraft((d) => ({ ...d, address: next }))}
            onHostCommit={() => describe(draft.address, draft.tls)}
            tls={draft.tls}
            onTlsChange={(next) => setDraft((d) => ({ ...d, tls: next }))}
            sending={sending}
            selected={selected}
            onSend={handleSend}
            onRefresh={handleRefresh}
            refreshing={refreshing}
            reflectNote={reflectNote}
            pickerSlot={
              catalog && selected ? (
                <MethodPicker
                  selected={selected}
                  catalog={catalog}
                  onSelect={(next) => setSelected(next)}
                  className="h-7 px-1.5 -ml-0 flex-1 min-w-0 justify-start"
                />
              ) : undefined
            }
          />
          <div
            className={cn(
              "flex-1 flex min-h-0 min-w-0",
              prefs.split === "horizontal" ? "flex-col" : "flex-row",
            )}
          >
            {selected ? (
              <RequestPanel
                ref={requestPanelRef}
                selected={selected}
                target={target}
                metadata={draft.metadata}
                onMetadataChange={(next) => setDraft((d) => ({ ...d, metadata: next }))}
                auth={draft.auth}
                onAuthChange={(next) => setDraft((d) => ({ ...d, auth: next }))}
                onDirty={() => setDraft((d) => (d.dirty ? d : { ...d, dirty: true }))}
                onRequestSave={() => setSaveOpen(true)}
                onNewRequest={newDraft}
                onSending={setSending}
                onOutcome={(o) => {
                  setOutcome(o);
                  setInvokeError(null);
                }}
                onError={(m) => {
                  setInvokeError(m);
                  setOutcome(null);
                }}
              />
            ) : (
              <div className="flex-1 min-w-0 min-h-0 flex items-center justify-center text-xs text-muted-foreground">
                Select a method to begin
              </div>
            )}
            <div className={cn(prefs.split === "horizontal" ? "h-px w-full" : "w-px h-full", "bg-border")} />
            <ResponsePanel state={respState} outcome={outcome} />
          </div>
          {invokeError && (
            <div className="fixed bottom-4 right-4 z-20 max-w-md rounded-md border border-destructive bg-destructive/10 px-3 py-2 text-xs text-destructive shadow-md">
              {invokeError}
            </div>
          )}
        </main>
      </div>

      <SaveRequestDialog
        open={saveOpen}
        onOpenChange={setSaveOpen}
        metas={collections.metas}
        loadCollection={collections.load}
        defaultName={selected ? selected.method : "request"}
        onSave={doSave}
        onCreateCollection={collections.createCollection}
      />

      <AlertDialog open={guard.open} onOpenChange={(o) => setGuard((g) => ({ ...g, open: o }))}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Unsaved changes</AlertDialogTitle>
            <AlertDialogDescription>
              You have unsaved edits in the current request. Save them, discard them, or cancel?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <Button variant="outline" onClick={() => setGuard((g) => ({ ...g, open: false }))}>
              Cancel
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                const next = guard.next;
                setGuard({ open: false, next: () => {} });
                next();
              }}
            >
              Discard
            </Button>
            <Button
              onClick={() => {
                setGuard({ open: false, next: () => {} });
                setSaveOpen(true);
              }}
            >
              Save…
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
    </div>
  );
}
```

  Note: `RequestPanel` gains an `onNewRequest` prop; add it to `RequestPanelProps` and render a "New request" (`+`) button next to Save in the head:
  ```tsx
  <Tooltip content="New request">
    <Button type="button" variant="ghost" size="icon-sm" onClick={onNewRequest}>
      <FilePlus className="size-3.5" />
    </Button>
  </Tooltip>
  ```
  (Import `FilePlus` from lucide-react alongside `Save`.) This is the concrete entry point that exercises the dirty-guard (criterion #6).

- [ ] **Step 4: Delete `src/features/shell/DisconnectedHero.tsx`.**

```bash
git rm src/features/shell/DisconnectedHero.tsx
```

- [ ] **Step 5: Verify `SidebarServicesPane` prop.** It currently takes `connected: boolean`; we pass `catalog != null`. Open `src/features/shell/SidebarServicesPane.tsx` and confirm it accepts `connected` + `catalog`. If its signature differs, adapt the call site (do NOT change the pane's behavior — just satisfy its existing props).

- [ ] **Step 6: Lint.**

Run: `pnpm lint`
Expected: PASS (tsc -b, zero errors). Fix any type errors (most likely: unused imports, the `EnvironmentIpc` inline import, or `icon-sm` size variant name — verify against `button.tsx`).

- [ ] **Step 7: Commit.**

```bash
git add -A
git commit -m "feat(frontend): lazy connect-on-Send, draft + Save dialog (plan-06b)"
```

---

## Task 10: Verify + live smoke

- [ ] **Step 1:** `cargo test --workspace` — expect PASS.
- [ ] **Step 2:** `pnpm lint` — expect PASS.
- [ ] **Step 3 (optional Rust live smoke):** `cargo test -p handshaker-core --test invoke_live -- --ignored --nocapture` against Notex `127.0.0.1:5002` — expect a reflected catalog + an invoke outcome printed, no panic.
- [ ] **Step 4: Browser smoke** via `pnpm tauri dev` + Chrome MCP:
  - App opens straight to request/response panes (no hero).
  - Enter `127.0.0.1:5002` → on blur the method picker fills.
  - Select a method → JSON skeleton loads in the body editor.
  - Click Send → response pane shows a green (status 0) or red (non-OK) pill.
  - Click the refresh icon → re-reflects without error.
  - Click Save → choose "+ New collection", name it, Save → no error.
  - Edit the body, click "New request" (`+`) → Save/Discard/Cancel dialog appears.
  - Check the devtools console: zero errors.
- [ ] **Step 5:** Commit any fixes discovered during smoke.

---

## Acceptance criteria (from spec §12)

1. No Connect/Disconnect; entering a valid address auto-populates the picker. — Tasks 8, 9.
2. Selecting a method loads its JSON skeleton without a held connection. — Tasks 1, 2, 9.
3. Send invokes via `grpc_invoke_oneshot`; OK → green pill, non-OK → gRPC code. — Tasks 2, 9.
4. Manual refresh re-reflects the contract. — Tasks 2, 9 (`handleRefresh`).
5. Save creates a request in a chosen collection; survives restart. — Tasks 7, 9.
6. Editing then starting a new draft prompts Save/Discard/Cancel. — Task 9 (dirty-guard + New request).
7. `pnpm lint` + `cargo test --workspace` green; live smoke passes. — Task 10.
8. Inline auth applied at send-time only; saved requests carry empty `auth_by_env`. — Tasks 6 (`draftToSavedRequest`), 9 (send).
