# Zero test warnings — design

**Status:** 📝 spec — awaiting plan

## Problem

`pnpm test` is green (167 files, 1213 tests) but writes 184 warnings to stderr. The
noise hides real regressions: a newly introduced `act(...)` warning is
indistinguishable from the 163 that are already there.

Measured breakdown of the current run:

| Warning | Count |
| --- | --- |
| `An update to <X> inside a test was not wrapped in act(...)` | 163 |
| `Missing \`Description\` or \`aria-describedby={undefined}\` for {DialogContent}` | 21 |

By component: Tooltip 81, CallPanel 19, UnderlineTabs 18, ScrollArea 14,
WorkflowEnvControl 13, SidebarShell 7, SavedAuthEditor 7, CatalogProvider 2,
RequestRow 1, AboutPane 1.

## Root causes

Four distinct mechanisms. Each was traced to a specific line and each fix was verified
to bring its file to zero warnings with tests still passing.

**1. Async effects settling after synchronous assertions.** The dominant cause — 145 of
the 163 `act` warnings. A component resolves a promise inside `useEffect` and sets
state while the test asserts synchronously right after `render`, so the update lands
outside `act`:

- `src/features/workflow/useEffectiveAuth.ts:26-30` — `authEffective(...).then(setAuth)`,
  mounted by `CallPanel.tsx:89-93`. Traced by instrumenting `console.error` to dump a
  stack: `dispatchSetState` ← `useEffectiveAuth.ts:28:23` ← `processTicksAndRejections`.
- `src/features/workflow/WorkflowEnvControl.tsx:33-39,62-64` — `setEnvs(await envList())`,
  mounted by `Titlebar`.
- `src/features/catalog/overview/SavedAuthEditor.tsx:54-56` — `ipc.envList().then(setEnvNames)`.
- `src/features/catalog/useCatalogTree.ts:97,115,120` — `void reload()` on mount, then
  `setTree` + `setLoading(false)` — exactly the 2 warnings in `ImportExportPane.test.tsx`.
- `src/features/settings/AboutPane.tsx:11-13` — `ipc.appVersion().then(setVersion)`.
- Two `CallPanel.editable` tests additionally kick off the async `useSend` pipeline and
  assert synchronously.

**The Tooltip / UnderlineTabs / ScrollArea warnings are not independent.** They are a
downstream cascade: an un-`act`ed update re-renders and commits the whole subtree, and
Radix's callback refs (`@radix-ui/react-compose-refs`) call `dispatchSetState` during
that commit. In `CallPanel.editable.test.tsx` one `useEffectiveAuth` update produces
~10 `Tooltip` warnings per affected test — 74 Tooltip + 18 UnderlineTabs from one root
cause. Confirmed by the fact that tests which already `await`ed something emitted zero.

**2. Mock-implementation leakage between tests.** `vi.clearAllMocks()` clears calls but
not implementations. `SidebarShell.test.tsx:122` sets
`vi.mocked(loadUiState).mockResolvedValue({ sort_key: "recent" })`, which leaks into
every later test; the mount effect at `SidebarShell.tsx:54-58` then really does call
`setSortKey` after those synchronous tests end. Exactly the 7 tests after line 122 warn,
each cascading 2 `ScrollArea` warnings — 21 total. Tests before line 122 never warned.

**3. Bare DOM calls in tests.** React Testing Library wraps only `fireEvent` /
`userEvent` in `act`. A direct `input.focus()` runs React's `onFocus` outside `act`, and
Radix `Tooltip` (always wrapped around the field at `VarHighlightInput.tsx:324-326`)
updates state from it — `VarHighlightInput.test.tsx:111` and `:128`, and the same helper
at `MetadataEditor.test.tsx:17`. A variant of the same shape:
`RequestRow.test.tsx:79` calls `setPref`, whose `broadcast` (`src/lib/use-prefs.ts:125`)
pushes state into the still-mounted row's `usePrefs` subscriber.

**4. A real production accessibility defect.** `SaveRequestDialog.tsx:212-214` renders a
`DialogHeader` with only a `DialogTitle`, so Radix's `aria-describedby` has no target and
screen-reader users get no dialog description. All 21 occurrences come from this one
component — 1 per test. This is a product bug the tests happened to surface.

## Approach: guard first

Make the warnings fail the suite before fixing them. The set of failing tests then *is*
the work list, and no fix can be declared done while its warning survives.

### The guard

One place: `src/test/setup.ts`.

- `beforeEach` replaces `console.error` and `console.warn` with collecting spies.
- `afterEach` asserts the collected list is empty, embedding the first captured message
  and stack in the failure so the origin stays visible.

Both channels are guarded. Every warning in the current run goes through
`console.error`, but guarding `console.warn` too catches library deprecations and
Radix's own warnings, which is what "zero warnings, honestly" means.

The assertion deliberately lives in `afterEach` rather than throwing from inside
`console.error`. React logs during render; an exception thrown from there would be
swallowed by an error boundary and produce a cascade of unrelated noise. Collecting and
asserting afterwards attributes the failure to the right test and keeps the stack.

Tests that expect a warning opt out the way `updaterContext.test.tsx:30` already does —
a local `vi.spyOn(console, "error").mockImplementation(() => {})` restored in `finally`.
It stacks on top of the guard spy and is removed by `mockRestore`, so no change is
needed there, and the same pattern is the sanctioned escape hatch going forward.

### Settling technique

For async mount effects the settle point is `await act(async () => {})`, not `waitFor`.
`waitFor`'s first predicate check can run before the pending microtask flushes, so it is
not a reliable barrier here; an async `act` scope drains the microtask queue inside the
`act` boundary. Where a file renders the same component many times, the flush belongs in
that file's existing `render` helper rather than at every call site. `findBy*` is
equally valid where the test is already asserting on content that appears after the
effect, since RTL routes it through the async-`act` wrapper.

### Fix buckets

Twelve test files plus one production component are affected. Every fix below was
verified to bring its file to 0 warnings with tests passing.

| Files | Warnings | Fix |
| --- | --- | --- |
| `CallPanel.editable.test.tsx`, `CallPanel.layout.test.tsx` | 111 | async `renderPanel` helper flushing with `await act(async () => {})`; plus a settle after the two `Ctrl+Enter` / `Ctrl+R` send assertions |
| `SaveRequestDialog.tsx` (+ `messages.ts`) | 21 | add an `sr-only` `DialogDescription`; per-mode copy in `messages.ts` |
| `SidebarShell.test.tsx` | 21 | re-assert the `loadUiState` default in `beforeEach` so no per-test `mockResolvedValue` leaks |
| `Titlebar.test.tsx` | 13 | flush inside the file's existing `render` helper |
| `SavedAuthEditor.test.tsx`, `CollectionOverview.test.tsx` | 7 | `renderEditor` helper / one settle after the tab click |
| `VarHighlightInput.test.tsx`, `MetadataEditor.test.tsx` | 7 | wrap `input.focus()` in `act(...)` |
| `ImportExportPane.test.tsx`, `AboutPane.test.tsx`, `RequestRow.test.tsx` | 4 | `findBy*` instead of `getBy*`; wrap the `setPref` reset in `act(...)` |

### Out of scope

No warning filtering or allowlist by message text — that would hide future real
problems. No production changes beyond `SaveRequestDialog`. No test refactoring beyond
what the guard demands.

## Verification

- `pnpm test` green, and its output contains no line matching `^Warning:`.
- `pnpm lint` green.
- `cargo test --workspace` unaffected but run as part of the gate.

## Risks

The guard could in principle fail tests over console output that the `^Warning:` count
never saw. Checked: the full run produces 71 stderr blocks and every one of them starts
with `Warning:`, and zero stdout blocks. So no unrelated `console.warn`/`console.error`
traffic is hiding in the suite today, and the buckets above account for all of it.

What remains is ordinary drift — a future test that logs deliberately. The sanctioned
answer is the local `vi.spyOn(console, …)` opt-out, not a change to the guard.
