# Review — ticket 12 "Surfacing the method kind": proposed answers Q1–Q5 + glossary

Reviewer read: `map.md`; tickets 07, 08, 09, 11, 12; the three `research/12-*` files; the code
named in the brief. All file:line citations are to the current `main` working tree.

## Headline findings (read these first)

1. **Q5(a) leaves a real, reachable gap, and it contradicts ticket 11.** History steps are
   *re-sendable*: List/Ledger mount `CallPanel` without `editable` (`ListView.tsx:27`,
   `LedgerView.tsx:52`), which renders `AddressBar step={step} onSend={send}`
   (`CallPanel.tsx:194`), and reflection is **off** for them (`useDraftReflection(..., !!editable, ...)`,
   `CallPanel.tsx:134-141`). So a history step has no catalog and no kind. Ticket 11 rule 15
   ("`CallPanel` picks the hook by kind") and rule 13 ("`streamId` replaced on an in-place
   re-Open") both assume the panel knows the kind. `streamId !== null` says "stream" but cannot tell
   server from client/bidi. Those two need different controls (`▶ Send`→`Cancel` vs
   `▶ Open`→`[Send message][Half-close][Cancel]`, ticket 09) and different core behaviour at
   Open (body sent or not, ticket 07 rule 2). Under Q5(a), re-sending a client-streaming snapshot
   goes down `grpc_send` and hits `MethodKindMismatch` **every time**. The proposed hint says
   "refresh reflection", which cannot help, because history panels never reflect.
2. **The proposed hint for Q3 misstates the cause.** The UI catalog (`grpc_describe`,
   cache-first, `src-tauri/src/commands/grpc.rs:64`) and the core gate (`activate` → same
   `ContractCache`, `contract.rs:30`) read **the same cache**. So the gate almost never fires
   because "the server's contract differs from the loaded one". It fires because **the UI did
   not know the kind**: null kind (catalog pending, failed, or cancelled), a history step with no
   kind, or a UI catalog left over from another target. A server that really changed after the
   cache was filled is invisible to *both* sides. That call goes out with the wrong cardinality,
   and tonic truncates it silently (research `12-contract-render…` Q3a, [E18][E19][E22]). The
   spec should name that as an accepted risk, not claim the gate covers it.
3. **A mismatch *within* streaming kinds is unaddressed.** Q3 guards unary↔streaming only. Neither
   ticket 11 nor ADR-0002 says who decides whether `stream_open` sends the draft body. Ticket 07
   rule 2 says it is sent for server-streaming and not for client/bidi; ticket 11 rule 1 says
   "server-streaming = … `once(msg)` outbound". If core decides from the descriptor while the UI
   picked controls from its own (possibly stale or unknown) kind, a UI-"server" vs core-"bidi"
   disagreement opens a stream that never gets its body, with only a Cancel button. A
   UI-"client" vs core-"server" disagreement sends a body the user never sent. That is the
   strongest argument for carrying **`expected` + `actual`** (below).
4. **Option costs are mis-stated in the Q1 framing.** `Step` is in-memory only: history does not
   survive a restart (ticket 08 rule 6), and `store.ts` has no persistence. A field on `Step`
   therefore costs no format break. Only `SavedRequestIpc` (`src-tauri/src/ipc/collection.rs:145-157`)
   is persisted, and even there an additive `#[serde(default)]` field is not a break. The real
   cost of persisting (c) is **staleness and reconciliation** (Bruno overwrites or clears it on
   every reflect, research `12-kind-source…` [S17]), not the format.

---

## Q1 — Source of the kind for a draft; behaviour while unknown

**VERDICT: agree with changes** (keep (a); fix the stated rationale; add a single derivation
site and kind pinning while a call is live).

**Strongest argument against (a).** Research `12-kind-source-and-history` Q1(b) and its
recommendation: no surveyed client assumes unary without a descriptor. grpcui gates Invoke on
the built form ([S3]); Insomnia throws "No reflection methods found" ([S5]). A draft sent while
the kind is unknown is "defaulting to unary", which the research explicitly lists under
`_Avoid_`.

**Why (a) still wins here.**
- The analogy is weaker than it looks. In those tools the UI's descriptor *is* the invoke
  source. In Handshaker the frontend catalog is only a UI cache: `sendStep` never reads it
  (`actions.ts:219-266`), and core activates and reflects by itself at Send (`send.rs:93-94`,
  `contract.rs:22-59`). "Refuse to invoke without a descriptor" already holds **in core**:
  `invoke_unary` resolves the descriptor and refuses a streaming method before any byte of the
  RPC is sent (`grpc/invoke/mod.rs:130-134`). The UI's `▶ Send` while the kind is unknown is a
  presentational default, not a semantic one.
- **Is there a bypass?** No. `grpc_send_impl` → `Sender::send` (`commands/grpc.rs:262-263`) →
  `crate::grpc::invoke_unary` unconditionally (`send.rs:95`). `invoke_unary` is the only caller
  of `unary_dynamic` outside tests. Every unary-path Send passes the gate. What happens *before*
  the gate is resolve, auth materialization (possibly an OAuth2 token fetch) and activate
  (possibly reflection RPCs). All harmless, and none of it is the method RPC.
- (b) regresses the dominant unary flow. Opening a saved request and hitting Ctrl+Enter
  immediately would be a silent no-op for the 400 ms debounce (`useDraftReflection.ts:9,94`) plus
  the reflect round-trip. The shortcut guard (`CallPanel.tsx:115`) would also need the kind. The
  UX sources in `12-interim-gating` Q4c (NN/g, Friedman, Silver, Pereira) argue against
  disabled-plus-tooltip whether the gate is permanent or temporary.

**Errors in the proposal's rationale.**
- "by which time the catalog is there" is **not guaranteed**. `useDraftReflection` is
  independent of Send's activate. If the draft's reflection errored or timed out, `catalog`
  stays `null` (`useDraftReflection.ts:76-79`) until an address or env change or a manual
  refresh, even though core's cache is now warm. Every re-press then repeats the mismatch. The
  hint must therefore offer the remedy (refresh), and must not assume the catalog will show up.
- A cancelled reflection **keeps the previous catalog** (`useDraftReflection.ts:74-79`). That
  catalog may belong to the previous env's host, so the kind can be derived from the wrong
  target. The gate catches the resulting disagreement; the spec should mention it once.

**Unstated but needed.**
- **One derivation site.** `CallPanel` owns `reflection.catalog`. It should compute
  `kind = kindOf(catalog, step.service, step.method): MethodKind | null` once, and feed
  (i) the `DraftAddressBar` badge and controls, (ii) `ContractInfo.kind`, (iii) the hook choice
  (ticket 11 rule 15), and (iv) the hotkey path (`sendShortcutRef`, `CallPanel.tsx:113-117`, also
  used by `RequestTabs onSubmit`, `CallPanel.tsx:216`). Otherwise the button and Ctrl+Enter can
  diverge.
- **`SelectedMethod.kind` is non-nullable** (`SelectedMethod.ts:8`) and is shared with
  `onSelect`. Keep that type. Pass `kind ?? "unary"` to `MethodPicker`: null and unary render
  the same (no badge, `MethodPicker.tsx:73`). Alternatively, give the picker a separate `kind`
  prop. Do not widen the type used by `onSelect`.
- **Pin the kind while a call is live.** A reflection refresh during an open stream can change
  the derived kind (a server redeploy, or a different env host). That would flip the hook
  mid-call. Rule: while a call is live, its controls use the kind the call was opened with (from
  core, see Q5); the catalog-derived kind applies only when no call is live.
- **Label morph.** A saved client/bidi request shows `▶ Send` until the catalog arrives, then
  `▶ Open`. Accept this explicitly; `useBusyDelay` does not cover it.

**Recommended rule.**
> The draft's method kind is derived live in `CallPanel` from the reflected catalog
> (`deriveKind` of the selected `service/method`), `MethodKind | null`, never stored on the draft
> or `SavedRequest`. `null` (catalog pending, failed, or method absent) shows no badge and unary
> controls, and Send takes the unary path, where the core gate refuses a streaming method before
> anything reaches the wire. While a call is live, controls follow the kind the call was opened
> with, not the catalog.

---

## Q2 — Contract `stream` modifiers

**VERDICT: agree with changes.**

**Strongest argument against.** `ContractInfo.kind` comes from the catalog, but the schema sides
come from a separate process-wide JS cache (`useMessageSchema.ts:7,48-58`) that fetches
**without** the reflection debounce. The schema can therefore arrive before the catalog. Printing
"without modifiers when kind is null" makes a streaming method *look unary*: a lie of omission,
not a neutral fallback. Research `12-contract-render…` Q2 recommends the catalog-derived kind as a
fourth argument to `renderContractDoc`. It adds that a catalog-independent source should be a
method-level DTO, not per-side schema flags, if the tab must render without a catalog.

**Assessment.** Divergence is transient, because both read the same core `ContractCache`
(`commands/grpc.rs:64,157`), and a manual refresh bumps the schema revision together with the
catalog (`CallPanel.tsx:148-151`). Adding flags to `MessageSchemaIpc` would be wrong in principle
(research [E9]-[E12]: streaming is a method property, and one message type can serve a unary and
a streaming rpc). So `ContractInfo.kind` is right. The fallback needs care: when kind is null,
**omit the `rpc` signature line** (still list the types) rather than print a unary-looking
signature. The Contract tab exists only for editable drafts (`CallPanel.tsx:229`,
`ResponsePanel.tsx:18`), so history is unaffected.

**Recommended rule.**
> The Contract tab's `rpc` line gets its modifiers from the same derived kind as the address bar
> (`ContractInfo.kind`): `stream` goes inside the parentheses before the type on each streaming
> side, `rpc Name(stream In) returns (stream Out);` (keyword token, types stay clickable). While
> the kind is unknown the signature line is not printed; message blocks still render.
> `MessageSchemaIpc` stays flag-free.

(If the user prefers the flash over a missing line, "print without modifiers" is acceptable. Say
so explicitly as a trade-off.)

---

## Q3 — Core gate once streaming exists

**VERDICT: agree with changes** (carry `expected` + `actual`; name it `kind_mismatch`; fix the
hint; put the gate in one shared lookup; state the stale-cache risk).

**Strongest argument against the proposal as written.** Its hint ("the server's contract differs
from the loaded one") is false in the common trigger cases (headline 2). It also covers only
unary↔streaming, not server↔client/bidi (headline 3).

**What the research supports.**
- A new structured variant rather than reusing `NotImplemented` or `MethodNotFound`: research
  `12-contract-render…` Q3(c), [E26]-[E30]. BurntSushi's structured-error argument, and the
  `io::ErrorKind` precedent that a case callers branch on gets its own variant.
- The pre-send descriptor check is the only reliable guard. No portable wire status exists:
  grpc-go and grpc-java return `Internal`, grpc-node returns `Unimplemented`, and tonic silently
  truncates in both directions (Q3a table, [E15]-[E24]). Do not try to classify a server
  `Internal "cardinality violation…"` into this face (research agrees).
- A face title that names the situation and a hint that names the remedy: [E31]-[E33].
- `NotImplemented` stays: confirmed still produced by `tonic_impl.rs:24-28` (skip_verify).

**`expected` / `actual` vs `actual` only.**
- If the only guarded direction were `grpc_send` → streaming, `expected` would always be `unary`
  and implied by the command, so `actual` alone would suffice.
- But the `stream_open` direction has three possible expectations, and the UI's choice matters,
  because controls and the Open semantics both depend on it (headline 3). Recommended:
  `stream_open` takes the kind the UI chose (`server | client | bidi`). Core compares it with the
  descriptor and refuses any difference. The outbound shape (`once(body)` vs channel) then follows
  a kind both sides agreed on. With that, `expected` is real data in both directions, and the
  message can be specific ("… is server-streaming but was called as unary"), as the Microsoft
  guidance "Specific: … values of the objects involved" [E32] asks.
- Shape: `CoreError::MethodKindMismatch { service, method, expected: MethodKind, actual: MethodKind }`.
  This needs a core `MethodKind { Unary, Server, Client, Bidi }` with a descriptor constructor, and
  an IPC mirror `MethodKindIpc` serialized as lowercase `"unary"|"server"|"client"|"bidi"`. The TS
  `MethodKind` (`SelectedMethod.ts:3`) can then be the generated type instead of a hand-written
  duplicate, so there is one source for the four values.

**FaultKind name.** `"contract"` is too broad. The existing `decode` hint already means "contract
stale" (`netDiagnostics.ts:30-31`). `ServiceNotFound` / `MethodNotFound`, currently `other`, would
also be "contract" faults, but the face title "Method kind mismatch" would be wrong for them.
`"kind"` reads badly (`fault.kind === "kind"`). `"stale"` asserts a cause that is usually wrong
(headline 2). **Recommend `"kind_mismatch"`**, which is also what the research suggests.

**Placement.** Put the descriptor lookup (service → method → `ServiceNotFound` /
`MethodNotFound` → `MethodKind`) in **one helper**, used by `invoke_unary` and
`Sender::open_stream` alike, before `unary_dynamic` / `stream_dynamic`. Then the gate cannot be
bypassed by a new path. In `open_stream` the refusal is a pre-Open fault: `stream_open` returns
`Err` and the `ClientErrorView` face shows, consistent with ticket 09 ("a client fault before
stream start keeps the existing `ClientErrorView` face") and ticket 11 rule 9.

**Scope consequences to state.**
- `from_core_error_exhaustive` count 17 → 18 (`src-tauri/src/ipc/error.rs:114`).
- Update the `invoke_unary` doc (`grpc/invoke/mod.rs:101`).
- Regenerate bindings and add TS fixtures (IPC shape change; `pnpm lint` + full `pnpm test`).
- `FACE` / `HINT` are `Record<FaultKind, …>`, so tsc forces the new key. **Per
  `.claude/rules/ui-strings.md`**, editing `ClientErrorView.tsx` (`FACE` titles at :15-25, inline
  fallback at :47) and `netDiagnostics.ts` (`HINT` at :21-34) obliges centralizing those
  files' existing inline strings into `src/lib/messages.ts`. Budget that cleanup into the ticket.

**Recommended rule.**
> Core refuses a call whose path does not match the method's kind in the loaded contract, before
> anything reaches the wire: `grpc_send` on a streaming method, and `stream_open` with a kind
> other than the descriptor's (the UI passes the kind it chose). Error:
> `MethodKindMismatch { service, method, expected, actual }` → `IpcError::MethodKindMismatch` →
> `FaultKind "kind_mismatch"`. Face "Method kind mismatch"; hint names both kinds and the remedy,
> e.g. "`Svc/M` is server-streaming but was called as unary — refresh reflection, then send
> again". Accepted risk: a server changed after the contract cache was filled is not detected, and
> tonic truncates silently until the user refreshes reflection.

---

## Q4 — Interim Send gating during implementation

**VERDICT: agree.**

**Strongest argument against.** The one case a branch-internal gate would guard is a live
`pnpm tauri:dev` demo mid-branch. That is not a user.

**Research.** `12-interim-gating` answers 1–2 and 5: Release Toggles and Keystone exist to keep a
*shipping* mainline healthy. The squash rule (`.claude/rules/squashing-feature-branches.md`)
keeps the half-built state off `main`. Postman shipped all four kinds together (Q4d). No
contradiction with ticket 07 rule 3.

**Additions.**
- Adopt the research's ordering advice as a spec constraint: the first implementation ticket is a
  walking skeleton that threads server-streaming end to end (core `stream_dynamic` → `stream_open`
  + `Channel` → timeline). The badge, pane and transport then arrive together.
- On the branch, once `MethodKindMismatch` replaces `NotImplemented`, a streaming Send before
  routing lands shows "refresh reflection". That is misleading, but only on the branch, and
  acceptable.

**Recommended rule.**
> No interim UI gating. Intermediate tickets land only on the feature branch, which is squashed
> before fast-forward, so `main` never shows a kind it cannot call. On the branch, the core gate
> is the safety net. Implementation tickets start with a server-streaming walking skeleton.

---

## Q5 — Kind in history / executed snapshots

**VERDICT: disagree** with (a). **Recommend** a variant of (c) that stores nothing new on `Step`.

**Why (a) fails.** See headline 1. Concretely, `useSend` would be called with a client-streaming
snapshot and route it to `grpc_send`, which hits the gate on every press. The hint's remedy does
not apply to a panel that never reflects. Ticket 11's rules 13 and 15 cannot be satisfied: the
"in-place re-Open" of a history step cannot choose `open` vs `send` or pick the controls. Also,
"the timeline + footer already say it was a stream" is about the *response* pane. The *controls*
live in the address bar (ticket 09) and must be chosen before the click.

**Precedent in the code for (c).** `useSend` already freezes *facts of the executed call* into the
snapshot: `auth: res.report.auth_used, tls: res.report.tls_used` (`useSend.ts:52-59`, doc comment
:37-40, "fact, not a second fetch"). The kind a call was executed as is the same sort of fact: it
cannot go stale, because it describes what happened, not what the server is now.

**Cheapest correct form (no new `Step` field).** Add `kind` to ticket 11's `Opened` event
(`Opened { kind, auth_used, tls_used, bytes_fields }`), so core, the source of truth, reports it.
The `streamStore` entry, which lives exactly as long as a step references it (ticket 11 rule 13),
keeps it. The executed kind of any step is then `streamId === null ? "unary" :
streamStore[streamId].kind`. The same value serves the "pin while live" rule from Q1. This is a
one-line amendment to ticket 11 and should be recorded as a Comment there. A `Step.kind` set only
on snapshots is the fallback: in-memory, no format break. Its field would carry a different
meaning on the draft (null) and on snapshots, which is a smell.

**Research.** `12-kind-source…` Q5 is split. grpcui shows no kind in history; Bruno labels past
calls with `methodType` from the saved item ([S11]). The research also says a badge earns its
place on a *list surface that mixes kinds* ([N3]). The workflow history list (`StepRow`) becomes
exactly that once streaming ships. Whether to *show* a badge (AddressBar / StepRow) is a UX choice
for the user. *Knowing* the kind is not optional.

**Related gap to flag, not necessarily decide here.** `AddressBar`'s status chip
(`AddressBar.tsx:28-34`) and `summarizeStep` (`stepView.ts`, `outcome`-based) read `Step.outcome`,
which stays unary-only for streams (ticket 11 rule 12). A stream snapshot would render no chip in
the header, and "draft" in `StepRow`. The new status `"cancelled"` (ticket 11 rule 14) is also
unhandled there. The spec should assign this to a ticket.

**Recommended rule.**
> An executed call's kind is a fact of the call, reported by core in `Opened.kind` and kept in its
> Stream store entry. A step with no `streamId` is unary. History panels (no catalog) pick controls
> and the hook from this executed kind. Nothing is persisted and nothing is re-derived from
> reflection. [User decision: whether the history header and `StepRow` show the kind badge.]

---

## Glossary — **Method kind**

**VERDICT: agree with changes.**
- Term choice is well supported: research `12-kind-source…` Terminology. It matches the code
  (`MethodKind`, `deriveKind`, `KindBadge`) and grpc.io's "four kinds of service method" [G1], and
  avoids "type", which collides with message types. Also add "method type" and "RPC type / call
  type" to `_Avoid_`, alongside "тип метода" and "streaming flag".
- "Never persisted" must be refined if Q5 is adopted: *never stored on a saved request or on the
  draft; an executed call records the kind it ran as*.
- **Location.** With `CoreError::MethodKindMismatch { expected, actual }` and a core `MethodKind`,
  the term spans core and frontend. Put the entry in `crates/handshaker-core/CONTEXT.md` (section
  Вызов, next to **Open** / **Stream call**, where the gate and `Opened.kind` live), and add a
  short `src/CONTEXT.md` entry for the UI rule (derived from the catalog; null = unknown; pinned
  while live). Or put one entry in core and a pointer in `src`. Existing entries are
  Russian-with-English-terms; follow that.

**Recommended entry (gist).**
> **Method kind (вид метода)**: the four-way classification of a method by its descriptor flags
> `client_streaming` / `server_streaming`: `unary` / `server` / `client` / `bidi`. The source of
> truth is the loaded contract. The UI derives it from the catalog (unknown while no catalog), and
> an executed call records the kind it ran as. It is never stored on a saved request. Core refuses
> a call whose path does not match it. _Avoid_: method type / RPC type / тип метода (collides with
> message types), streaming flag, stream kind (excludes unary).

---

## What the ticket asked that the proposals leave unstated

1. **Who decides the Open semantics** for server vs client/bidi (body at Open or not): core from
   the descriptor, or the frontend via `stream_open` + `stream_send` + `stream_half_close`. This is
   ambiguous between ticket 07 rule 2 and ticket 11 rule 1. It determines whether a within-streaming
   mismatch is harmless or silently wrong. Recommendation: the UI passes its kind to `stream_open`,
   core gates on it, and core picks `once` vs channel.
2. **One derivation site** in `CallPanel`, feeding badge, controls, Contract, hook choice and
   hotkey.
3. **Kind pinning** while a call is live.
4. **History panels' kind source** (Q5).
5. **Accepted risk**: stale core cache → wrong cardinality → silent tonic truncation.
6. **String hygiene** triggered by the edits (`ClientErrorView` `FACE`, `netDiagnostics` `HINT`,
   `MethodPicker` `KindBadge` labels at `MethodPicker.tsx:206-215`, "Select a method" at :78): all
   inline today; the ui-strings rule forces centralization of each touched file.
7. **Tests the spec should list**: core gate both directions (including server↔bidi via
   `stream_open`), `FakeTransport` untouched on refusal; `DraftAddressBar` badge from the catalog,
   no badge when null; `renderContractDoc` modifiers for all four kinds and the null-kind case;
   `faultFromIpcError` → `kind_mismatch`; history re-send routing by executed kind.
8. **Stream-snapshot summaries** (`AddressBar` chip, `StepRow` status) are outcome-based and blind
   to streams and `"cancelled"`. Assign them to a ticket.

## Questions the driving session should put to the user before resolving

1. **Q5 display**: should the read-only history header and/or the `StepRow` list show the kind
   badge (`stream`/`client`/`bidi`)? Knowing the kind is required either way; showing it is taste.
   The research favours a badge on the mixed list and none on the header.
2. **Null-kind Send that hits the gate**: show the `kind_mismatch` face, or silently re-route
   **once** to the stream path using `actual`? Re-routing is safe: the unary attempt put nothing
   on the wire, and for client/bidi re-routing means Open, which sends nothing. It avoids an error
   face for a user who just pressed Ctrl+Enter too early.
3. **FaultKind scope**: `kind_mismatch` only, or a broader "contract" face that later also absorbs
   `ServiceNotFound` / `MethodNotFound` (today `other`)? If broader, the face title cannot be
   "Method kind mismatch".
4. **Contract tab while the kind is unknown**: omit the `rpc` line, or print it without modifiers
   and accept a brief unary-looking flash?
5. **Server-streaming Send implementation** (item 1 above): confirm that `stream_open` carries the
   UI's kind and core gates on it, and record it as a Comment on ticket 11. Also add `kind` to the
   `Opened` event there.
