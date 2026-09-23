# Edit Environment window — improvements — design

**Date:** 2026-06-11
**Status:** draft (awaiting spec review)
**Branch:** `claude/upbeat-goldwasser-100321`

## Problem

The Edit/New Environment dialog ([EnvEditorDialog.tsx](../../../src/features/envs/EnvEditorDialog.tsx))
has three usability gaps the user wants closed:

1. **Window does not scale with the app.** `DialogContent` is overridden to a fixed
   `max-w-2xl` (672px) and has **no height cap** — so on a large main window it stays a
   small box, and with many variables the table can grow past the viewport with no
   internal scroll (footer pushed off-screen). The base
   [dialog.tsx:62](../../../src/components/ui/dialog.tsx) provides only `sm:max-w-lg` and
   no `max-h`.
2. **Long values are unreadable/uneditable.** Each variable value is a single-line
   `<Input>` ([VariablesTable.tsx:120](../../../src/features/envs/VariablesTable.tsx)); a
   long URL or JWT just scrolls off the right edge with no way to see it whole.
3. **Layout spends vertical space loosely.** Name and Color are two separate labeled
   blocks with the 10-swatch palette as its own bottom section, squeezing the variables
   table — the part that matters most.

**Out of scope** (explicitly cut during brainstorming): secret/masked values, bulk
`KEY=VALUE` paste, variable drag-reorder, duplicate-environment.

## Design

Three coordinated changes, all confined to the envs feature plus one new shared
`ui/popover` primitive. The base `dialog.tsx` is **not** modified — sizing is applied
via `className` on this dialog instance only, so other dialogs are untouched.

### 1. Sizing + scroll frame (S1)

`EnvEditorDialog`'s `DialogContent` className changes from `max-w-2xl` to a
viewport-proportional, height-capped flex column:

- Width: `w-[min(90vw,960px)]` — grows and shrinks with the main window, capped so
  key/value rows never become uncomfortably long.
- Height: `max-h-[85vh]`.
- Layout: override the base `grid` with `flex flex-col` (twMerge keeps the last display
  utility, so `flex flex-col` wins over the base `grid`). `min-h-0` so children may shrink.

Inside, three pinned regions frame one scrollable region:

```
<DialogContent className="w-[min(90vw,960px)] max-h-[85vh] flex flex-col">
  <DialogHeader>…</DialogHeader>                     {/* pinned */}
  <DialogDescription className="sr-only">…</…>       {/* a11y, visually hidden */}
  <div>{/* identity row: name + color */}</div>      {/* pinned */}
  <div className="min-h-0 flex-1 overflow-auto">     {/* scrolls */}
    <Label>Variables</Label>
    <VariablesTable … />
  </div>
  {error && …}                                        {/* pinned */}
  <DialogFooter>…</DialogFooter>                       {/* pinned */}
</DialogContent>
```

Name, color, and Save/Cancel stay visible regardless of how many variables exist; only
the variables list scrolls.

### 2. Layout — identity row + color popover (L1)

- The separate **Name** block and bottom **Color** section collapse into one top
  *identity row*: `[ name input (flex-1, font-mono) ] [ color dot button ]`.
- The visible "Name" `<Label>` is dropped; the input gains `aria-label="Name"` so both
  screen readers and the existing `getByLabelText("Name")` tests keep working.
  Duplicate-name error text stays directly under the row.
- The color control becomes a single round swatch showing the current
  `effectiveColor`; clicking it opens a **Popover** containing the existing 10-swatch
  grid (5×2). Picking a swatch sets `pickedColor` and closes the popover. The trigger
  has `aria-label="Environment color"`; each swatch keeps its `aria-label`/`aria-pressed`.
- The dialog `<DialogTitle>` stays (`New environment` / `Edit environment`); the
  descriptive sentence moves into a `sr-only` `DialogDescription` (Radix needs a
  description for a11y; we just hide it).
- `effectiveColor = pickedColor ?? defaultColorKeyForName(trimmedName)` and the whole
  save flow ([EnvEditorDialog.tsx:89-129](../../../src/features/envs/EnvEditorDialog.tsx))
  are unchanged.

### 3. Value editing — focus-to-expand (B)

In [VariablesTable.tsx](../../../src/features/envs/VariablesTable.tsx) the **value** cell
changes from `<Input>` to an auto-growing `<textarea>` (the **key** cell stays a
single-line `<Input>` — keys are short identifiers):

- **Blurred:** one line tall, content clipped — reads exactly like today's single-line
  input (no wrap, overflow hidden).
- **Focused:** wraps (`break-all`/`pre-wrap`) and auto-grows to fit content, **capped at
  ~6–8 lines**; beyond the cap the textarea scrolls internally so an 800-char JWT can't
  blow up the dialog.
- Auto-grow is a small ref hook: on focus and on input, set
  `el.style.height = 'auto'` then `el.style.height = min(scrollHeight, cap)`; on blur,
  reset to the one-line height. Lives inside the envs feature (a `ValueCell` sub-piece of
  `VariablesTable`), not a generic `ui/textarea`.
- Row alignment becomes top-aligned (`align-top`) so the delete `✕` sits at the top of a
  grown row.

The trailing "Add variable" row keeps its current behaviour: the key input drives row
creation, the value field stays disabled until a key exists.

### 4. New / touched files

- **New:** `src/components/ui/popover.tsx` — shadcn Popover on the unified `radix-ui`
  package (`import { Popover as PopoverPrimitive } from "radix-ui"`), mirroring the
  pattern in [dropdown-menu.tsx](../../../src/components/ui/dropdown-menu.tsx).
- **Edited:** `EnvEditorDialog.tsx` (sizing frame + identity row + popover),
  `VariablesTable.tsx` (textarea value cell + auto-grow hook).
- **Unchanged:** `dialog.tsx`, `colors.ts`, all backend/IPC (no model change — values
  stay `Record<string,string>`).

## Testing

- **Keep green** — existing suites pass unchanged in spirit:
  - [EnvEditorDialog.test.tsx](../../../src/features/envs/EnvEditorDialog.test.tsx):
    `getByLabelText("Name")` holds via `aria-label`; color/rename/delete flows unchanged.
  - [VariablesTable.test.tsx](../../../src/features/envs/VariablesTable.test.tsx):
    `getByDisplayValue` / `getByPlaceholderText("Add variable")` work on a `<textarea>`
    too (key input keeps the `"Add variable"` placeholder; value placeholder is `"value"`).
- **Add:**
  - Color popover: open it, click a swatch, assert `ipc.envUpsert` is called with the
    chosen color (in create mode, distinct from the name-derived default).
  - Structural: the value cell renders as a `<textarea>`.
- **Live-verify in WebView2** (not assertable in jsdom — `scrollHeight === 0` there):
  the focus auto-grow + height cap, the variables list internal scroll, and the dialog
  scaling/shrinking with the main window. Consistent with the project's live-verification
  norm for layout/Monaco-style behaviour.

## Risks / notes

- twMerge override of `grid`→`flex` on `DialogContent` is the same mechanism the base
  component relies on for `sm:max-w-lg`; confirm the rendered content is `display:flex`
  (the base `gap-4` is retained and harmless).
- Popover renders in a Radix portal; ensure it layers above the Dialog overlay (Radix
  handles z-index via portal order — verify the swatch grid is clickable over the dialog).
