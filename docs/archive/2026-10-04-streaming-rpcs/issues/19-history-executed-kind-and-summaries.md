# 19: History — executed kind, re-send routing, `StepRow` badge, stream status summaries

**What to build:** Past stream calls behave correctly in the workflow history, where
panels never reflect and there is no catalog. The kind a call ran as is a fact of the
call: core reports it in `Opened.kind`, the `streamStore` entry keeps it, and a step with
no `streamId` is unary. Controls follow one precedence rule: while a call is live, the kind
it was opened with; otherwise the catalog kind; otherwise the kind of the step's last
executed call; otherwise `null` — so a reflection refresh cannot flip the controls
mid-call, and a history client-streaming snapshot re-opens with `▶ Open` and the
segmented controls, a history server-streaming snapshot re-sends with `▶ Send`. The
history list row (`StepRow`) shows the kind badge; the read-only history header does not
(the timeline and footer already say "stream"). The address-bar status chip and the step
summary read a stream's `End` (OK / code) or `Cancelled` — the same as the footer —
instead of the unary-only outcome, so a stream snapshot no longer renders as "draft" with
no chip; the `"cancelled"` status is handled everywhere the status is summarized.

**Blocked by:** 16 (Client-streaming & bidi — controls for every kind exist)

**Status:** resolved

- [x] A history snapshot of a client-streaming call shows `▶ Open` and, once opened, `[Send message][Half-close][Cancel]`; a server-streaming snapshot shows `▶ Send` → `Cancel`; a unary snapshot is unchanged
- [x] Re-opening a history stream step replaces its `streamId`; the old store is released by the release rule
- [x] While a call is live, a catalog change (env switch / refresh) does not change the controls; after the call ends the catalog kind wins again
- [x] With no catalog and a previously executed call, the draft's controls follow the executed kind
- [x] `StepRow` shows the kind badge for stream steps and none for unary; the read-only history header shows no badge
- [x] Address-bar chip and `summarizeStep` show `OK` / `<code>` / `Cancelled` for stream snapshots; `"cancelled"` is rendered wherever `Step.status` is summarized
- [x] Tests: precedence rule (live → catalog → executed → null); history re-send routing by executed kind with the two-shape `@/ipc/client` mock; `StepRow` badge and status; chip/summary for `End` and `Cancelled`
- [x] Strings of touched files in the messages module
- [x] Gate green: `pnpm lint` + `pnpm test` + `cargo test --workspace`

## Comments

**2026-09-28 — resolved.** Commits on `claude/streaming-rpcs`: `e4dcb36` (precedence + history
routing + shared `CallControls`), `f9ccb3b` (summaries + `StepRow` badge + shared `KindBadge`),
`386506d` (doc), `262e3ec` (review fixes). Frontend only.

- **Precedence** in one place: `controlsKind({ liveKind, catalogKind, executedKind })` =
  `liveKind ?? catalogKind ?? executedKind` (`src/features/workflow/controlsKind.ts`);
  `executedKind(step, entry)` = the `streamStore` entry's `kind` (core's `Opened.kind`) for a
  step with `streamId`, `"unary"` for a step with a unary `outcome`, else `null` — a released
  entry is never resurrected. `CallPanel` feeds the result to `DraftAddressBar` / `AddressBar`
  (badge + `▶ Send` / `▶ Open` + two-way controls) and to `useCall({ kind })`; the Contract
  tab stays on the catalog kind only. Nothing is stored on the draft or a saved request.
- **History**: `AddressBar` (read-only header) takes `kind` + `twoWay` and renders the shared
  `CallControls` (no badge); a client snapshot re-opens with `▶ Open` → segmented controls, a
  server snapshot `▶ Send` → `Cancel`, unary unchanged; re-open replaces `streamId` and the
  release rule frees the old entry. `StepRow` shows `KindBadge` for stream steps only.
- **Summaries**: `terminalResult(step, entry)` (stream `End` wins, else unary outcome) feeds
  `statusChip` (`✓ OK · <elapsed>` / `✕ <code> <NAME>` / `○ Cancelled` / `✕ error`) and
  `summarizeStep` (`✓ 0` / `✕ 5` / `cancelled`); both `switch (step.status)` exhaustive.
  `useStreamEntry(id)` is a per-id selector (rows re-render only for their own stream);
  shared `TONE_TEXT` / `TONE_BG`; strings `messages.workflow.addressBar.chip.*`,
  `workflow.step.railTitle`.
- **Accepted deviation** (story 57): the unary history-header chip now reads `✕ <code> <NAME>`
  and formats elapsed via `formatElapsed` (was `✕ error` / raw ms) — one vocabulary with the
  footer; the draft bar and unary pane are unchanged.
- **Gate**: cargo 459 passed (no Rust change); lint clean; vitest 183 files / 1505 tests.
- Whole-feature sanity: every user story 1–57 maps to a resolved ticket (13–19).
