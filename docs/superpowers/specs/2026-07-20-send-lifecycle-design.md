# One home for the Send lifecycle — design

Status: 🎉 DONE (2026-07-20) — implemented, reviewed, live-verified, merged.

Candidate from the architecture review: the Send lifecycle is spread across ~8
frontend modules, CallPanel and FocusView co-author it, and the executed-history
snapshot's auth comes from a **separate** `auth_effective` fetch that can drift
from the auth `grpc_send` actually used (a stale window). Goal — one deep entry
point (`useSend`) and a snapshot that records fact from the core.

Aligned with ADR-0001 and completes it: one pick rule — one home, now for the
history snapshot too. Resolved secrets still never travel through the frontend.

## Decisions (grilling)

1. **Scope**: both parts — the IPC change + the frontend `useSend`.
2. **Wire**: `grpc_send` returns a `SendReportIpc` wrapper, not an extended
   `InvokeOutcomeIpc` (the outcome stays a pure invoke result).
3. **Owner**: `useSend` itself commits the executed snapshot and `bumpUsage`
   (when an `origin` is passed); the `onExecuted` prop dies.
4. **Absorption**: `stepPatchFromSendResult`, `shouldRecordExecuted`,
   `buildExecutedStep` become internals of `useSend`; `sendStep`/`cancelStep`
   remain the IO adapter in `actions.ts`.

## Core (`crates/handshaker-core`)

- `EffectiveRequest` gains `picked_auth: Option<SavedAuthConfig>` — the winning
  config in **template** form (as stored in the collection). `resolve_request`
  already computes `picked` (resolve.rs, auth pick) and drops it — now it lands
  in the result. `None` = unauthenticated.
- TLS needs nothing extra: it already lives in `eff.target`.

## IPC (`src-tauri`)

New DTO in `ipc/invoke.rs`:

```rust
pub struct SendReportIpc {
    pub outcome: InvokeOutcomeIpc,
    pub auth_used: SavedAuthConfigIpc, // templates; kind=none — unauthenticated
    pub tls_used: bool,                // from eff.target
}
```

- `grpc_send` / `grpc_send_impl` → `Result<SendReportIpc, IpcError>`.
  `auth_used`/`tls_used` are captured from `eff` **before** the move into the
  work closure.
- The materialized header is not returned (ADR-0001: secrets don't travel).
- The term **Send report** goes into `src-tauri/CONTEXT.md` (Language).
- Regenerating `src/ipc/bindings.ts` is mandatory; `client.ts::grpcSend` gets
  the new type.

## Frontend (`src/features/workflow`)

New module `useSend.ts`:

```ts
useSend(step, { envName, onPatch, origin? }): { send, cancel }
```

- `send()` owns the lifecycle: `status === "sending"` gate → `requestId` →
  `sendStep` → internal `applySendResult` (patch; on ok — executed snapshot with
  `auth: report.auth_used`, `tls: report.tls_used`) →
  `workflowStore.commitExecutedStep` + `useCatalog().bumpUsage(origin)` — only
  when `origin` is passed (Focus mode). Ledger/List don't pass `origin` — they
  don't record history, same as today.
- `onPatch` is a parameter: Focus → `updateDraft`, Ledger/List → `updateStep`.
- `actions.ts`: `SendResult.ok` now carries `report: SendReportIpc`; the
  `stepPatchFromSendResult` / `shouldRecordExecuted` / `buildExecutedStep`
  exports are deleted.
- `CallPanelProps`: minus `onExecuted`, minus the dead `originAuth` (documented
  as unread but still drilled from FocusView); plus `origin?`.
- `useEffectiveAuth` survives **only** for the Auth tab (live display per
  ADR-0001); it leaves the snapshot path.

## Tests

- **Rust**: `resolve.rs` — asserts on `picked_auth` (request-wins,
  collection-fallback, env-gate, none); a unit test for the
  `eff → SendReportIpc` mapping.
- **TS**: new `useSend.test.ts` (mocked `sendStep`): ok → patch+commit+bump;
  unresolved → error patch; cancelled → draft; re-Send gate; the snapshot takes
  auth/tls from the report, not from `useEffectiveAuth`. Update
  `actions.test.ts` (`SendResult` shape), sync `grpcSend` mocks in fixtures,
  CallPanel tests without `onExecuted`.
- **Gate**: `pnpm lint` + `pnpm test` + `cargo test --workspace` + bindings
  regeneration (the IPC shape changes — a cargo-only gate is not enough).
