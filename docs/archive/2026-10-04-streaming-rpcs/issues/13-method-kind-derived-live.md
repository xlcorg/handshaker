# 13: Method kind derived live + badge + Contract `stream` + `useSend` prefactor

**What to build:** The address bar shows the selected method's kind badge (`stream` /
`client` / `bidi`) taken from the reflected catalog instead of a hardcoded `unary`, and
the Contract tab prints the proto-style signature `rpc Name(stream In) returns (stream
Out);`. While the catalog is not there yet (pending, failed, method absent) the UI shows
no badge, unary controls and no signature line — it never claims "unary" when it does not
know. The call panel derives the **Method kind** (`MethodKind | null`) exactly once and
feeds the badge, the Contract tab and the send path from that one value;
`SelectedMethod.kind` stays non-nullable (`kind ?? "unary"` into the picker). Nothing is
stored on the draft or a saved request. Prefactoring for the streaming tickets: the
helpers `useStreamCall` will share with `useSend` (draft extraction from a step,
executed-snapshot construction, usage bump) are extracted; inline user-facing strings of
every touched file (kind-badge labels, "Select a method", Contract rendering) move to the
messages module.

**Blocked by:** None (can start immediately)

**Status:** resolved

- [x] Selecting a server-streaming / client-streaming / bidi method shows the matching badge in the address bar; a unary method shows none
- [x] With no catalog (`null` kind) the address bar shows no badge and the existing unary Send behaviour; the badge appears when the catalog arrives, without user action
- [x] The kind is computed in one place in the call panel and passed down; no second `deriveKind` call site for the same step
- [x] Contract tab renders `stream` inside the parentheses on each streaming side as a keyword token; message types stay clickable; unary methods render as today
- [x] Contract tab omits the `rpc` signature line while the kind is `null` and still renders the message blocks
- [x] The per-side message-schema DTO gains no streaming flags
- [x] `useSend`'s reusable pieces (draft-of-step, executed snapshot, usage bump) are exported helpers with unchanged unary behaviour
- [x] Strings of the touched frontend files live in the messages module (`ui-strings.md`)
- [x] Tests: badge from catalog for all four kinds and none for `null`; `renderContractDoc` for all four kinds and the `null` case; unary `useSend` suite still green
- [x] Gate green: `pnpm lint` + `pnpm test` + `cargo test --workspace`

## Comments

**2026-09-28 — resolved** (commit `8356726` + review fix-ups on `claude/streaming-rpcs`).

- Shipped: `kindOf(catalog, service, method): MethodKind | null` (`src/features/shell/SelectedMethod.ts`,
  re-exported via `@/lib/method-kind`); `CallPanel` derives `kind` once (`useMemo`) and feeds
  `DraftAddressBar kind=` (badge; picker gets `kind ?? "unary"`) and `ContractInfo.kind`
  (`renderContractDoc(method, input, output, kind)` emits a `stream ` keyword token per streaming
  side, omits the signature block for `null`). `useSend` prefactor: `sendDraftOf` / `sendCtxOf` /
  `callOptionsOf` / `SendableStep` (`actions.ts`), `executedSnapshot` / `bumpOriginUsage`
  (`useSend.ts`). Strings of touched files moved to `messages.ts`.
- Gate: `pnpm lint` clean; `pnpm test` 173 files / 1311 tests green; no Rust touched.
- Review (standards + spec): no violations. Applied: restored the `cancelStep` doc comment,
  `DraftAddressBar` imports `MethodKind` through the `@/lib/method-kind` facade, plain
  `kind === null ? null : […]` in `proto.ts`.
- **Accepted deviation:** while `useDraftReflection` is *refreshing* (address edit after a first
  successful load) the previous catalog stays in place, so the kind is derived from the stale
  catalog until the new one lands, instead of `null`. Gating on `loading` would flicker the badge
  on every refresh; first load / failed reflection / method absent are `null` as specified.
- Note for later tickets: `ContractInfo.kind` / `ContractViewProps.kind` are required props;
  `kind` in `CallPanel` is the single value to branch the hook choice and Ctrl+Enter path on.
