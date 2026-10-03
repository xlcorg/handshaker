# Surfacing the method kind in the UI

Type: grilling
Status: resolved
Blocked by: —
Map: ../map.md

## Question

Small and known, ticketed now that the pane (09) and sending (07) decisions have landed:

- **Address bar**: `DraftAddressBar` hardcodes `kind: "unary"` for the MethodPicker's
  selected method — derive it from the catalog entry (`deriveKind`) so the `stream` /
  `client` / `bidi` badge shows for the draft, and decide whether a saved request /
  history step needs the kind persisted on `Step` (the catalog may be unavailable when
  a step is rendered) or re-derived on reflection.
- **Contract tab**: the rpc line shows no `stream` modifiers — add `stream` on the
  input/output side (`rpc Name(stream In) returns (stream Out)`), proto-style.
- **`NotImplemented` gate**: `invoke_unary` rejects streaming methods
  (`grpc/invoke/mod.rs:130`); once the streaming branch exists the gate goes, but the
  unary path must still refuse a streaming method that reaches it (which error, which
  face).
- **Send gating**: what the Send button does when the method is streaming and the
  streaming branch is not yet wired (during the phased implementation) — disabled with a
  tooltip, or the existing client-error face.

Resolution = the three UI rules and the gate rule the spec states.

## Comments

**2026-09-26, research before the decision** (user asked for best-practice research on
every question, then an independent review): three research files —
[kind source + history + terminology](../research/12-kind-source-and-history.md),
[contract rendering + kind-mismatch errors](../research/12-contract-render-and-kind-mismatch.md),
[interim gating](../research/12-interim-gating.md). Headline facts:

- Every open-source client (grpcurl, grpcui, Insomnia, Bruno) derives the kind from the
  descriptor at invoke time; Bruno/Kreya also persist a copy and have to reconcile it.
  Nobody assumes "unary" when no descriptor is available — they fail fast.
- The wire carries no kind; servers dispatch by `:path` only. **tonic 0.14.6 silently
  truncates** a wrong-cardinality call in both directions (only zero messages →
  `Internal "Missing request/response message."`), so a pre-send descriptor check in core
  is the only reliable gate and must exist on both paths.
- proto3 grammar: `rpc Name ( stream In ) returns ( stream Out )`; the flags are
  method-level in every descriptor API (never on the message).
- Release toggles are "inventory with a carrying cost"; disabled buttons + tooltips are a
  known UX problem (NN/g, Silver); the squash-then-ff rule means `main` never carries the
  half-built state.
- Industry noun is "method type" (grpc-java `MethodType`, Postman, Bruno); grpc.io says
  "four kinds of service method"; Insomnia's values `unary|server|client|bidi` equal ours.

**2026-09-26, independent review** of the proposed answers:
[review](../research/12-review.md) — found the history-panel gap (no catalog → no kind),
the within-streaming mismatch (who decides Open semantics), and a misstated hint cause
(UI catalog and core gate read the same `ContractCache`).

## Answer

Resolved 2026-09-28 (grilling, two rounds; every recommendation accepted). Rules the spec
states:

1. **Kind source for a draft.** `CallPanel` derives the method kind once, live, from the
   reflected catalog: `kindOf(catalog, service, method): MethodKind | null` (`deriveKind`
   of the entry). That single value feeds the `DraftAddressBar` badge and controls,
   `ContractInfo.kind`, the hook choice (ticket 11 rule 15) and the Ctrl+Enter path
   (`sendShortcutRef` / `RequestTabs onSubmit`). Never stored on the draft or on
   `SavedRequest`. `null` (catalog pending / failed / method absent) = no badge, unary
   controls, Send takes the unary path. `SelectedMethod.kind` stays non-nullable —
   `MethodPicker` receives `kind ?? "unary"` (null and unary render the same). The
   `▶ Send` → `▶ Open` morph when a client/bidi catalog arrives is accepted. Rejected:
   persisting the kind on `SavedRequest` (Bruno-style reconcile cost); disabling Send
   while the kind is unknown (breaks the instant Ctrl+Enter unary flow).
2. **Controls kind = catalog kind, else executed kind.** While a call is live its
   controls follow the kind it was opened with (`Opened.kind`), not the catalog. When
   no call is live: the catalog kind if known, otherwise the kind of this step's last
   executed call (`Opened.kind` in its Stream store entry); otherwise `null`.
3. **Who decides Open semantics.** `stream_open` carries the kind the UI chose
   (`server | client | bidi`); core compares it with the descriptor, refuses any
   difference, and on agreement picks the outbound shape itself (`once(body)` for server,
   channel for client/bidi). `Opened` gains `kind`. Recorded as a Comment on ticket 11.
4. **Core gate.** One shared descriptor lookup (service → method → `ServiceNotFound` /
   `MethodNotFound` → `MethodKind`) used by both `invoke_unary` and `Sender::open_stream`
   before `unary_dynamic` / `stream_dynamic`, so no path bypasses it. A mismatch returns
   `CoreError::MethodKindMismatch { service, method, expected, actual }` (core
   `MethodKind { Unary, Server, Client, Bidi }` built from the descriptor) →
   `IpcError::MethodKindMismatch` 1:1 (`MethodKindIpc` = `"unary"|"server"|"client"|"bidi"`;
   the TS `MethodKind` becomes the generated type) → `FaultKind "kind_mismatch"`, face
   "Method kind mismatch", hint naming both kinds and the remedy (e.g. "`Svc/M` is
   server-streaming but was called as unary — refresh reflection, then send again").
   Narrow scope: `ServiceNotFound` / `MethodNotFound` stay `other`. `NotImplemented`
   stays only for genuinely unwired paths (skip_verify). Server-side
   `Internal "cardinality violation…"` is **not** classified into this face.
   `from_core_error_exhaustive` 17 → 18; bindings regen + TS fixtures.
5. **Auto re-route once.** On `kind_mismatch` from a Send / Open the frontend retries
   **once** via the path of `actual` (unary → `grpc_send`; streaming → `stream_open`
   with `actual`). Safe: the refused attempt put nothing on the wire, and client/bidi
   re-route = Open, which sends nothing. The face appears only if the retry mismatches
   again (defensive — both sides read one cache).
6. **Accepted risk.** A server whose contract changed after the `ContractCache` was
   filled is invisible to both UI and core; the call goes out with the wrong cardinality
   and tonic truncates silently (research Q3a) until the user refreshes reflection.
7. **Contract tab.** The `rpc` line takes its modifiers from `ContractInfo.kind` (same
   derived kind): `stream` inside the parentheses before the type on each streaming side,
   `rpc Name(stream In) returns (stream Out);` — `stream` is a keyword token, types stay
   clickable. While the kind is `null` the signature line is **omitted**; message blocks
   still render. `MessageSchemaIpc` stays flag-free (streaming is a method property).
8. **No interim Send gating.** Intermediate tickets live only on the feature branch,
   squashed before ff, so `main` never shows a kind it cannot call; on the branch the core
   gate is the safety net. **Constraint for `/to-tickets`:** the first implementation
   ticket is a walking skeleton threading server-streaming end to end (core
   `stream_dynamic` → `stream_open` + `Channel` → timeline pane).
9. **History.** An executed call's kind is a fact of the call (`Opened.kind`, kept in its
   Stream store entry); a step with no `streamId` is unary. History panels (no catalog)
   pick controls and hook from it. Nothing new on `Step`, nothing re-derived from
   reflection. `StepRow` shows the kind badge (mixed-kind list); the read-only history
   header does **not** (timeline + footer already say "stream").
10. **Stream-snapshot summaries.** The `AddressBar` status chip and `summarizeStep` /
    `StepRow` status read a stream's `End` (OK / code) or `Cancelled` — the same as the
    footer statusline — instead of the unary-only `Step.outcome`; status `"cancelled"`
    (ticket 11 rule 14) handled. Belongs to the pane ticket.
11. **String hygiene** (by `ui-strings.md`, not a new decision): touching
    `ClientErrorView` (`FACE`), `netDiagnostics` (`HINT`), `MethodPicker` (`KindBadge`
    labels, "Select a method") moves those files' inline strings into
    `src/lib/messages.ts`.
12. **Tests the spec lists.** Core gate both directions incl. server↔bidi via
    `stream_open`, `FakeTransport` untouched on refusal; `DraftAddressBar` badge from the
    catalog, none when `null`; `renderContractDoc` modifiers for all four kinds + the
    null-kind case; `faultFromIpcError` → `kind_mismatch`; one-shot re-route (success and
    second-mismatch face); history re-send routing by executed kind; catalog-else-executed
    controls fallback.
13. **Glossary.** **Method kind (вид метода)** added to `crates/handshaker-core/CONTEXT.md`
    (Вызов) with a UI-rule entry in `src/CONTEXT.md`.
