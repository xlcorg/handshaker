# Collections Frontend — Address Bar + Send/Save (Design)

**Status:** approved (brainstorming) → ready for plan
**Date:** 2026-05-31
**Sub-project:** #2 of 3 in the Collections feature (see master spec §0.1 and the #1 backend spec `2026-05-31-plan-06-collections-backend-design.md`).

## 0. Summary

This sub-project rewires the frontend onto the #1 backend: it replaces the explicit
**Connect / Disconnect** connection model with a **lazy connect-on-Send** model, adds a
frontend data layer (`useCollections`) over the stable `collection_*` IPC surface, introduces
a single **`currentRequest` draft**, and ships a **Save-request** dialog.

Request **tabs** and the full sidebar **collections tree / node-views / per-env auth editor**
are explicitly out of scope (deferred to #2b and #3 respectively — see §8).

### 0.1 Decisions locked during brainstorming

| # | Decision | Choice |
|---|----------|--------|
| 1 | Contract-fetch trigger for the address bar | **Auto-reflect on address blur / debounce** |
| 2 | Draft model | **Single draft** (no tabs; tabs → #2b) |
| 3 | Dirty handling on switching to a saved request | **Prompt Save / Discard / Cancel** |
| 4 | Auth in #2 | **Inline auth = send-time only; not persisted** (`auth_by_env` empty on save) |
| 5 | Old connection commands | **Remove `grpc_connect` / `grpc_disconnect` / `grpc_invoke_unary` + `state.connection`** |
| 6 | DisconnectedHero / idle scenario | **Remove entirely**; show request/response panes immediately |

## 1. Scope

**In scope:**

- Frontend data layer `useCollections` (list + lazy tree load + CRUD wrappers, refetch-on-mutate).
- A single `currentRequest` draft (address, service/method, body, metadata, inline-auth, origin, dirty).
- Address bar **without** Connect/Disconnect: TLS toggle + address input + method picker + Send, in one row.
- Auto-reflect on address blur/debounce → populate the method picker.
- Lazy connect-on-Send via `grpc_invoke_oneshot` (activate through `ContractCache` + invoke; connection not held).
- Save-request dialog (name + collection/folder location; create-new or update-in-place).
- Dirty-guard (`alert-dialog`: Save / Discard / Cancel) before replacing a dirty draft.

**Out of scope (deferred):**

- Request **tabs** → **#2b** (own design cycle).
- Sidebar **collections tree**, node-views, context menus, empty-folder hiding → **#3**.
- **Per-env auth editor** (the `auth_set_for_env` UI) → **#3**.

## 2. Architectural shift: drop the held connection

The #1 backend already routes `activate()` through the `ContractCache`. This sub-project
removes the **held-connection** model entirely:

- Delete the `state.connection` slot (`Mutex<Option<Arc<GrpcConnection>>>`).
- The `ContractCache` becomes the sole holder of descriptor pools / catalogs between calls.
- A connection (`GrpcConnection`) now lives only for the duration of a single `grpc_invoke_oneshot`
  (or `grpc_describe` on a cache miss) and is dropped immediately after.

This is the rewiring master spec §4 ("Activated gRPC connections = 1", lazy) and the #1 spec
(§lines 39–40) defer to #2.

## 3. Backend: command surface

### 3.1 Removed

Commands, their `client.ts` wrappers, their `collect_commands!` registration, the
`state.connection` slot, and the `ConnectionStateChanged` event:

- `grpc_connect`
- `grpc_disconnect`
- `grpc_invoke_unary`
- the connection-based `grpc_build_request_skeleton` signature (replaced — see §3.2)

`ConnectInput` / `ConnectOutcome` DTOs are removed (no longer referenced).

> **Event note:** `ContractUpdated { target_key }` is **kept** (emitted by describe/refresh).
> `ConnectionStateChanged` is removed because there is no persistent connection state to report.

### 3.2 Added / changed (all target-based, no held connection)

The IPC `GrpcTarget` shape is `{ address: string, tls: boolean, skip_verify: boolean }`
(the existing `GrpcTarget` core type already serializes this way). The frontend resolves the
address template via `vars_resolve` **before** building the target, so `address` is already
`{{var}}`-free. The command still routes through `GrpcTarget::new()` for validation.

| Command | Signature | Behaviour |
|---|---|---|
| `grpc_describe` | `(target: GrpcTarget) -> ServiceCatalogIpc` | **Cache-first.** `key = ContractKey::from_target(&target)`; if `cache.get(&key)` is `Some`, return its `catalog` **without opening a channel**. On miss, `activate(target, transport, cache)` (reflects, populates cache) → return catalog. Emit `ContractUpdated { target_key }`. This is the auto-reflect-on-blur path; cache-first avoids a TCP/h2 handshake per address edit. |
| `grpc_refresh_contract` | `(target: GrpcTarget) -> ServiceCatalogIpc` | Target-based now. `cache.invalidate(&key)` then `activate(...)`. Manual refresh. Emit `ContractUpdated`. |
| `grpc_build_request_skeleton` | `(target: GrpcTarget, service: String, method: String) -> String` | Read pool from `cache.get(&key)`; build skeleton from that pool **without a channel**. On miss, `activate(...)` first, then build. |
| `grpc_invoke_oneshot` | `(target: GrpcTarget, request: InvokeRequest) -> InvokeOutcomeIpc` | `conn = activate(target, transport, cache)` (channel required), then `invoke_unary(&conn, request.service, request.method, request.request_json, request.metadata)`. Drop `conn` immediately. Non-OK gRPC status surfaces in `InvokeOutcomeIpc.status_code` (NOT `Err`); `Err` only for client-side failures, exactly as `invoke_unary` today. |

> **`grpc_describe` channel rationale (verified):** `activate()` opens the channel
> *before* the cache check (`crates/handshaker-core/src/grpc/contract.rs:25` — `transport.channel(&target)`
> precedes `cache.get`). Because describe fires on every address blur/debounce, describe must
> consult the cache directly and only fall through to `activate()` on a miss; otherwise each
> keystroke-blur opens a fresh connection.

### 3.3 Core change (handshaker-core)

Add a pool-based skeleton builder so the skeleton command needs no `GrpcConnection`:

```rust
// crates/handshaker-core/src/grpc/invoke/mod.rs
pub fn build_request_skeleton_from_pool(
    pool: &prost_reflect::DescriptorPool,
    service: &str,
    method: &str,
) -> Result<String, CoreError> { /* current body of build_request_skeleton, using `pool` */ }

// existing conn-based fn delegates:
pub fn build_request_skeleton(
    connection: &GrpcConnection, service: &str, method: &str,
) -> Result<String, CoreError> {
    build_request_skeleton_from_pool(&connection.pool, service, method)
}
```

Export `build_request_skeleton_from_pool` from `grpc::mod`. (Keeping the conn-based fn as a
thin delegate avoids touching its existing call sites/tests.)

### 3.4 IpcError

No new variants. `grpc_describe` / `grpc_invoke_oneshot` surface the existing
`InvalidTarget` / `Reflection` / `ReflectionDisabled` / `Transport` / `EncodeRequest` /
`DecodeResponse` / `ServiceNotFound` / `MethodNotFound` variants.

## 4. Frontend data layer

### 4.1 `useCollections` hook — `src/features/collections/useCollections.ts`

Single access point to collections from UI. Mirrors the env-dialog refetch pattern
(no new events; mutations propagate via command reply + refetch — master §6.3).

State:
- `metas: CollectionMetaIpc[]` — from `collection_list`.
- `byId: Record<string, CollectionIpc>` — lazily-loaded full trees.
- `loading: boolean`, `error: string | null`.

API:
- `refreshList(): Promise<void>` → `collection_list` → set `metas`.
- `load(id): Promise<CollectionIpc>` → `collection_get` → cache in `byId`.
- `createCollection(name): Promise<string>` → builds an empty `CollectionIpc` (uuid v7 id,
  empty items/variables, default `auth_by_env`, `default_tls=false`, `skip_tls_verify=false`),
  `collection_upsert`, refresh list, return id.
- `addRequest(collectionId, parentId, item): Promise<void>` → `collection_add_item` → reload that collection.
- `rename / move / duplicate / remove / restore` — thin wrappers over the matching `collection_*`
  IPC, each reloads the affected collection (or refreshes the list for `remove`).

All `HashMap`-typed fields use the same `Partial<{[k]:string}>` ↔ plain-object coercion the
env dialogs already use (Plan #4 errata #2).

### 4.2 `currentRequest` draft

A single draft, held in `App.tsx` (or extracted to a small `useDraftRequest` hook):

```ts
type DraftRequest = {
  address: string;        // template, may contain {{var}}
  tls: boolean;
  skipVerify: boolean;    // always false in #2 (no UI to set it)
  service: string | null;
  method: string | null;
  kind: MethodKind | null;
  body: string;           // JSON template
  metadata: MetadataRow[];
  auth: AuthState;        // inline (none/bearer) — send-time only
  origin: { collectionId: string; itemId: string } | null;
  dirty: boolean;
};
```

- `origin == null` → scratch draft; Save creates a new `SavedRequest`.
- `origin != null` → loaded from a saved request; Save updates it in place.
- `dirty` flips `true` on any field edit after load/save; resets after Save or after loading another request.

Draft ↔ `SavedRequestIpc` mapping (for Save):

| Draft | SavedRequest |
|---|---|
| `address` | `address_template` |
| `tls` | `tls_override: tls` (always `Some` in #2) |
| `body` | `body_template` |
| `metadata[]` | `metadata` (HashMap) |
| `service` / `method` | `service` / `method` |
| — | `auth_by_env`: **empty** (decision #4) |

`loadIntoDraft(saved: SavedRequestIpc, origin)` populates the draft from a saved request,
sets `origin`, `dirty=false`, `auth = none` (saved requests carry no inline auth in #2).

## 5. Address bar UI

Rewrite `src/features/shell/ConnectionBar.tsx` (kept as the same file; rename of the exported
component to `AddressBar` is optional — keep `ConnectionBar` to minimize churn). **No**
Connect/Disconnect buttons.

Layout (preserves the load-bearing one-row handoff pattern, `h-14`/56px, controls `h-9`/36px):

```
[TLS toggle] [ address input │ "/" │ method-picker ] [↻ refresh] [Send]
```

- **TLS toggle** — `h-9 w-9` outline icon (Lock/Unlock), tooltip. No longer disabled by a
  connected state (there is none).
- **Address input** — mono 12.5px, always editable. On `onBlur` **and** a ~400ms debounce,
  when non-empty:
  1. `vars_resolve(address)` → if `unresolved_vars` or `cycle_chain`, leave the picker untouched
     and show a quiet inline hint (not an error toast).
  2. `grpc_describe({ address: resolved, tls, skip_verify: false })` → catalog → fill picker.
     On reflection error, show a non-blocking note under the address; picker stays empty.
- **Method picker** — existing `MethodPicker`, fed by the describe catalog. Auto-select the
  first method when a catalog arrives and none is selected (same logic `App.tsx` has today).
  Changing method reloads the skeleton via `grpc_build_request_skeleton(target, service, method)`.
- **Refresh icon** — `h-9 w-9` ghost, next to the picker; calls `grpc_refresh_contract(target)`
  (invalidate + reflect). Disabled while no resolvable address.
- **Send** — primary, `h-9`, min-width 88px, `Send` icon + "Send" / spinner + "Sending".
  Disabled when `!service || !method || sending`.

Removed from `App.tsx`: `connected`, `connecting`, `handleConnect`, `handleDisconnect`,
`onConnectionStateChanged` subscription, and `DisconnectedHero` (file deleted). The
request/response panes render immediately. When no method is selected, the request pane shows
the existing "Select a method to begin" placeholder; the body editor is empty/`{}`.

## 6. Send flow (`grpc_invoke_oneshot`)

In `RequestPanel.send()` (and the Ctrl/Cmd+Enter handler), replace `grpc_invoke_unary` with:

1. `JSON.parse(body)` guard → `vars_resolve(body)` (unresolved/cycle → error toast, as today).
2. `vars_resolve(address)` → `target = { address: resolved, tls, skip_verify: false }`.
   If the address has unresolved vars/cycle → error toast, abort.
3. Build `metadata` map; if inline auth is bearer, `vars_resolve(token)` →
   `metadata["authorization"] = "Bearer " + resolved` (exactly the current logic).
4. `grpc_invoke_oneshot({ target, request: { service, method, request_json: resolved, metadata } })`.
5. `sending` / `outcome` / `invokeError` states and `ResponsePanel` unchanged.

The send path no longer depends on a `connected` flag — it depends only on a selected
service/method and a resolvable address.

## 7. Save-request dialog + dirty-guard

### 7.1 `SaveRequestDialog` — `src/features/collections/SaveRequestDialog.tsx`

Built on `ui/dialog.tsx`, inline-sized like the env dialogs. Trigger: a Save control next to
Send (or in the request-pane head), enabled when `service` + `method` are set.

Fields:
- **Name** (text).
- **Location** — collection dropdown (from `collection_list`, with inline "+ New collection")
  and an optional **folder** picker scoped to that collection's **top level only** (deep tree
  navigation is #3; #2 supports "collection root, or a top-level folder").

On submit, build `SavedRequestIpc` from the draft (§4.2 mapping; `auth_by_env` empty) and:
- `origin == null` → new item: generate `ItemId` (uuid v7 on the frontend — IPC `into_core`
  parses it), `collection_add_item(collectionId, parentId, item)`. Set `origin`, `dirty=false`.
- `origin != null` (plain Save) → replace the node in the loaded tree and `collection_upsert(collection)`.
  Set `dirty=false`.

**Frontend uuid v7:** add the `uuid` npm package (v7 supported) for `ItemId`/`CollectionId`
generation; a tiny `src/lib/ids.ts` wrapper exposes `newId()`.

### 7.2 Dirty-guard

When something would replace the current draft with a saved request while `draft.dirty`, show
`ui/alert-dialog.tsx` with **Save / Discard / Cancel**:
- Save → run the save flow, then load.
- Discard → load, dropping edits.
- Cancel → no-op.

> **#2 entry points:** the clickable sidebar tree is #3. In #2, `loadIntoDraft` is implemented
> and exercised by the Save flow (after a save, the draft becomes origin-bound) and is ready for
> #3 to call from the tree. #2 does not add a full sidebar tree UI.

## 8. Deviations from the design handoff

`docs/design_handoff_handshaker/README.md` (2026-05-28) predates the Collections master spec
(2026-05-31), which deliberately supersedes its connection model. This sub-project intentionally
deviates as follows; an errata entry records it:

- **Removes Connect / Disconnect** and the `idle` / `connecting` / `connected` scenarios
  (handoff §"Interactions", §"Screens"). Replaced by lazy connect-on-Send.
- **Removes `DisconnectedHero`** entirely (decision #6). The request/response panes render
  immediately; no onboarding hero screen.
- **Preserved** (load-bearing, handoff §"Notes for the implementer" line 282): the one-row
  address-bar pattern (TLS + address + method picker + Send), the searchable `MethodPicker`
  popover, underline tabs, status-pill semantics, and all design tokens / sizing.

## 9. Error handling

Reuse the existing `App.tsx` / `RequestPanel` patterns:

- `vars_resolve` unresolved/cycle → non-blocking toast.
- `grpc_describe` reflection error (`ReflectionDisabled` / `Reflection` / `Transport`) →
  non-blocking note under the address; picker stays empty; UI never crashes.
- `grpc_invoke_oneshot` client-side error → `invokeError` toast; non-OK gRPC status → normal
  `outcome` with `status_code != 0` (red pill).
- All IPC errors are the typed `IpcError` union; narrow by `type`.

## 10. Testing

- **Rust:** pure logic (cache-first describe path, `build_request_skeleton_from_pool`) covered by
  unit tests with `InMemoryContractCache`. `grpc_describe` / `grpc_invoke_oneshot` exercised by
  extending `crates/handshaker-core/tests/invoke_live.rs` (`#[ignore]`, against Notex
  `127.0.0.1:5002`): describe → catalog, oneshot → `NotesService/Create` → status 0.
  Note: the live test targets core APIs (`activate` + `invoke_unary`), which is what the new
  commands wrap.
- **Frontend:** no Vitest in the project. Guarantee = `pnpm lint` (tsc) green after `bindings.ts`
  regen + new wrappers/components.
- **Manual smoke (Chrome MCP + `pnpm tauri dev`):** enter `127.0.0.1:5002` → auto-reflect fills
  picker → select method → skeleton loads → Send → OK; Save into a new collection → restart dev →
  request persists. Check console for zero errors.

## 11. File structure

**handshaker-core:**
- Modify `crates/handshaker-core/src/grpc/invoke/mod.rs` — add `build_request_skeleton_from_pool`, delegate.
- Modify `crates/handshaker-core/src/grpc/mod.rs` — export it.
- Modify `crates/handshaker-core/tests/invoke_live.rs` — add describe/oneshot smoke (optional, `#[ignore]`).

**src-tauri:**
- Modify `src-tauri/src/commands/grpc.rs` — remove connect/disconnect/invoke_unary; add
  `grpc_describe`, `grpc_invoke_oneshot`; retarget `grpc_refresh_contract` + `grpc_build_request_skeleton`.
- Modify `src-tauri/src/commands/events.rs` — remove `ConnectionStateChanged`.
- Modify `src-tauri/src/state.rs` — remove the `connection` slot.
- Modify `src-tauri/src/lib.rs` — update `collect_commands!` (remove 3, add 2).
- Modify `src-tauri/src/ipc/*` — drop `ConnectInput`/`ConnectOutcome` if unreferenced.

**Frontend:**
- Create `src/features/collections/useCollections.ts`.
- Create `src/features/collections/SaveRequestDialog.tsx`.
- Create `src/lib/ids.ts` (uuid v7 wrapper).
- Modify `src/features/shell/ConnectionBar.tsx` — remove Connect/Disconnect, add refresh, auto-reflect.
- Delete `src/features/shell/DisconnectedHero.tsx`.
- Modify `src/features/invoke/RequestPanel.tsx` — oneshot send; skeleton via target.
- Modify `src/App.tsx` — drop connection lifecycle/state; wire draft + describe + Save.
- Modify `src/ipc/client.ts` — remove old wrappers, add `grpcDescribe` / `grpcInvokeOneshot`,
  retarget `grpcRefreshContract` / `grpcBuildRequestSkeleton`.
- Regenerate `src/ipc/bindings.ts`.
- Add `uuid` to `package.json`.

## 12. Acceptance criteria

1. No Connect/Disconnect anywhere; entering a valid address auto-populates the method picker.
2. Selecting a method loads its JSON skeleton without a held connection.
3. Send invokes via `grpc_invoke_oneshot`; OK shows a green pill, non-OK shows the gRPC code.
4. Manual refresh re-reflects the contract for the current address.
5. Save creates a new request in a chosen collection; it survives an app restart.
6. Editing then switching the draft to a saved request prompts Save/Discard/Cancel.
7. `pnpm lint` and `cargo test --workspace` are green; live smoke against Notex passes.
8. Inline auth is applied at send time only; saved requests carry empty `auth_by_env`.

## 13. References

| Ref | Path | Relevance |
|---|---|---|
| #1 backend spec | `docs/superpowers/specs/2026-05-31-plan-06-collections-backend-design.md` | IPC surface, ContractCache, model |
| Master MVP spec | `docs/superpowers/specs/2026-05-26-handshaker-mvp-design.md` | §4 lazy connection, §5.5, §6.2 |
| Design handoff | `docs/design_handoff_handshaker/README.md` | Address bar pattern (preserved); connect flow (superseded — §8) |
| Plan #4 errata #2 | `docs/superpowers/errata/2026-05-27-plan-04-env-vars.md` | HashMap → `Partial<{...}>` coercion |
