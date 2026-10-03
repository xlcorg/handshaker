# 17: Kind gate — `MethodKindMismatch`, `kind_mismatch` face, one-shot re-route

**What to build:** Core refuses any call whose path does not match the method's **Method
kind** in the loaded contract before a byte reaches the wire — the unary path on a
streaming method, and `stream_open` with a kind other than the descriptor's (including
server ↔ client/bidi) — through **one shared descriptor lookup** (service → method →
`ServiceNotFound` / `MethodNotFound` → kind) used by both paths. The error is structured:
`MethodKindMismatch { service, method, expected, actual }` in core (a core `MethodKind`
enum built from the descriptor), mirrored 1:1 in IPC (`MethodKindIpc` serialized as
`"unary" | "server" | "client" | "bidi"`; the frontend `MethodKind` becomes the generated
type) and mapped to a new fault kind `kind_mismatch` with the face "Method kind mismatch"
and a hint naming both kinds and the remedy ("… is server-streaming but was called as
unary — refresh reflection, then send again"). When a Send / Open hits it, the frontend
**re-routes once** via the path of `actual` (a user who pressed Ctrl+Enter before the
catalog arrived never sees an error); the face appears only if the retry mismatches again.
`NotImplemented` remains only for genuinely unwired paths (skip_verify). `ServiceNotFound` /
`MethodNotFound` stay in the generic bucket; server-side cardinality errors are not
classified into this face. Touching the client-error face and the diagnostics hints moves
their inline strings to the messages module.

**Blocked by:** 16 (Client-streaming & bidi — `stream_open` with every kind exists)

**Status:** resolved

- [x] Unary Send on a server / client / bidi method returns `MethodKindMismatch { expected: unary, actual: <kind> }` with the transport untouched (FakeTransport records no call)
- [x] `stream_open(kind = server)` on a bidi method, and `kind = bidi` on a server-streaming method, are refused the same way as pre-Open `Err`; matching kinds proceed
- [x] `from_core_error` exhaustive mapping grows by one; bindings regenerated; TS fixtures for `MethodKindIpc` and the new `IpcError` variant
- [x] `faultFromIpcError` maps the variant to `kind_mismatch`; the face shows the title and a hint containing both kinds and "refresh reflection"
- [x] With a `null` UI kind, Send on a server-streaming method transparently opens the stream (one retry via `actual`); Open with a stale `server` kind on a bidi method transparently re-opens as bidi; a unary method mistakenly opened as a stream falls back to `grpc_send`
- [x] A second mismatch on the retry shows the face instead of looping
- [x] `NotImplemented` still surfaces for skip_verify as today
- [x] Inline strings of the client-error face and the diagnostics hints live in the messages module
- [x] Tests: core gate both directions incl. server ↔ bidi; IPC mapping; frontend re-route success and second-mismatch face
- [x] Gate green: `pnpm lint` + `pnpm test` + `cargo test --workspace`

## Comments

**2026-09-28 — resolved.** Commits on `claude/streaming-rpcs`: `02dec65` (core + IPC gate),
`64b81fb` (face / mapping / strings), `1ff50dc` (re-route), `cfad221` (review fixes).

- **Core**: one shared lookup `find_method_of_kind(pools, service, method, expected)` (wraps
  `find_method`; bare `find_method` survives only for skeleton/schema) used by `invoke_unary`
  and `Sender::open_stream` after `prepare` and before the call reaches the wire.
  `CoreError::MethodKindMismatch { service, method, expected, actual }` — `expected` = the kind
  the caller's path implied (unary path → `Unary`; `open_stream` → the UI's kind), `actual` =
  the descriptor kind (= the path the re-route takes). `MethodKind::of / as_str / Display`.
  Unary Send on a streaming method and `open_stream` with any differing kind (incl. server ↔
  client/bidi, streaming kinds on a unary method) are refused with `unary_calls ==
  stream_calls == 0`; `NotImplemented` remains only for skip_verify. `Opened.kind` equals the
  descriptor kind by construction.
- **IPC**: `IpcError::MethodKindMismatch` mirrored 1:1 (`MethodKindIpc` snake_case);
  `from_core_error` 20 → 21; bindings regenerated; TS fixture `kindMismatch`. Frontend
  `MethodKind = MethodKindIpc`.
- **Frontend**: `FaultKind "kind_mismatch"`; face "Method kind mismatch"; message
  "`Service/Method` is <actual label> but was called as <expected label>", hint "Refresh
  reflection, then send again." (`messages.methodKind.label`, `workflow.fault.kindMismatch*`,
  `response.clientError.*` — face titles centralized). New orchestrator
  `src/features/workflow/useCall.ts` — `useCall({ step, envName, kind, onPatch, record, origin })
  → { send, cancel, sendMessage, halfClose }` owns `useSend` + `useStreamCall`; `send()` tries
  the path implied by `kind` (`null` → unary), on `kind_mismatch` retries ONCE via `actual`
  (`useSend.send({ retry })` / `useStreamCall.open(kind, { retry })` skip the `sending` gate
  explicitly — no stale-closure reliance), a second mismatch patches the face; a Cancel between
  the refusal and the retry wins (no second IPC call, step back to `draft`). `CallPanel` uses
  `useCall`; history panels (null kind) re-route stream snapshots transparently.
- **Accepted / recorded**: the gate runs after `prepare` (channel open, reflection on a cache
  miss, auth materialized) because the descriptor comes from `activate`; a re-route therefore
  runs `prepare` twice. `open_stream(Unary)` on a unary method returns `MethodKindMismatch
  { Unary, Unary }` (documented; unreachable from the UI, which never opens with `unary`).
- **Gate**: cargo 439 passed; lint clean; vitest 180 files / 1454 tests. Bindings fresh.
- Note for 19: the controls-kind precedence rule slots into `CallPanel` around `kind` /
  `liveEntry` (16 already derives live controls from the live entry's kind).
