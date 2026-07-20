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

Three distinct mechanisms, not one.

**1. Bare DOM calls in tests.** React Testing Library wraps only `fireEvent` /
`userEvent` in `act`. A direct `input.focus()` runs React's `onFocus` handler outside
`act`, and Radix's `Tooltip` updates state from it. Verified experimentally: wrapping
the two `input.focus()` calls in `src/features/vars/VarHighlightInput.test.tsx` in
`act(...)` drops that file from 6 warnings to 1, tests still passing.

**2. Async effects settling after synchronous assertions.** Components resolve a
promise inside `useEffect` and set state — `ipc.envList().then(setEnvNames)` in
`SavedAuthEditor.tsx:55`, `refreshEnvs` in `WorkflowEnvControl.tsx`, `useEffectiveAuth`
in `CallPanel.tsx`. Tests assert synchronously right after `render`, so the microtask
lands outside `act`.

**3. A real production accessibility defect.** `SaveRequestDialog` renders a Radix
`DialogContent` with no `DialogDescription` and no explicit
`aria-describedby={undefined}`, so screen readers get no description. All 21
occurrences come from this single component. This is a product bug the tests happened
to surface, not a test artifact.

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

### Fix buckets

Twelve test files are affected. Each bucket is driven to green independently. The
file-to-bucket assignment below is the expectation from the sampled run; the guard's
actual failures are authoritative, and a file may need fixes from more than one bucket.

| Bucket | Files | Fix |
| --- | --- | --- |
| a11y defect | `SaveRequestDialog.tsx` | add a `DialogDescription` to the `DialogContent`; its copy goes in `src/lib/messages.ts` |
| Bare DOM calls | `VarHighlightInput`, `Titlebar`, `SidebarShell`, `CallPanel.editable`, `CallPanel.layout`, `MetadataEditor` | wrap `focus()` / `blur()` / `click()` in `act(...)`, or replace with the matching `fireEvent` |
| Async effects | `SavedAuthEditor`, `CollectionOverview`, `AboutPane`, `ImportExportPane`, `RequestRow` | `await waitFor` / `findBy*` instead of asserting synchronously after `render` |

### Out of scope

No warning filtering or allowlist by message text — that would hide future real
problems. No production changes beyond `SaveRequestDialog`. No test refactoring beyond
what the guard demands.

## Verification

- `pnpm test` green, and its output contains no line matching `^Warning:`.
- `pnpm lint` green.
- `cargo test --workspace` unaffected but run as part of the gate.

## Risks

The guard may surface warnings absent from the sampled run — flaky timing, unhandled
rejections in files that currently pass quietly. Those are findings, not obstacles, and
are fixed through the same buckets.
