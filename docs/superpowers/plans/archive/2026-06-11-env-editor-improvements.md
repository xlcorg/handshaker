# Edit Environment window improvements — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Edit/New Environment dialog scale with the main window (height-capped, internal scroll), edit long values comfortably (focus-to-expand textarea), and tighten the layout (name + color in one identity row, color behind a popover).

**Architecture:** Pure frontend. No backend/IPC/model change — variables stay `Record<string,string>`. One new shared `ui/popover` primitive (shadcn on the unified `radix-ui` package); the rest is edits to two files in `src/features/envs`. The base `ui/dialog.tsx` is **not** touched — sizing is applied via `className` on this dialog instance only.

**Tech Stack:** React 18, TypeScript, Tailwind (twMerge via `@/lib/cn`), `radix-ui` (unified package), shadcn-style UI components, Vitest + Testing Library (jsdom).

**Status banner:** draft — not started. Branch: `claude/upbeat-goldwasser-100321` (already an isolated worktree). Spec: [docs/superpowers/specs/2026-06-11-env-editor-improvements-design.md](../specs/2026-06-11-env-editor-improvements-design.md).

---

## File Structure

- **Create** `src/components/ui/popover.tsx` — shadcn Popover wrapper over `radix-ui`'s `Popover`. One responsibility: a portalled popover primitive (Root/Trigger/Content). Untested standalone (matches the project's untested `ui/*` convention); its behaviour is exercised through the dialog's color-popover test.
- **Modify** `src/features/envs/VariablesTable.tsx` — value cell becomes an auto-growing `<textarea>` (`ValueCell`); key cell stays a single-line `<Input>`.
- **Modify** `src/features/envs/EnvEditorDialog.tsx` — height-capped/scaling `DialogContent` flex frame with an internally-scrolling variables region; name + color collapse into one identity row; color palette moves into a Popover; description becomes `sr-only`.
- **Modify tests** `src/features/envs/VariablesTable.test.tsx`, `src/features/envs/EnvEditorDialog.test.tsx`.

Commands (run from the worktree root):
- Single file: `pnpm test src/features/envs/VariablesTable.test.tsx`
- Full FE suite: `pnpm test`
- Typecheck: `pnpm lint` (`tsc -b`)
- Build: `pnpm build`

---

## Task 1: Add the `ui/popover` primitive

**Files:**
- Create: `src/components/ui/popover.tsx`

**Rationale for no unit test:** `ui/*` primitives are untested in this codebase (see `dialog.tsx`, `dropdown-menu.tsx` — no `.test.tsx`). The popover's real behaviour is covered by Task 3's integration test. This task only adds the file and proves it typechecks.

- [ ] **Step 1: Create the popover component**

Create `src/components/ui/popover.tsx` (mirrors the `dropdown-menu.tsx` pattern — unified `radix-ui` import, `data-slot` attributes, `bg-popover`/`text-popover-foreground` theme tokens):

```tsx
import * as React from "react"
import { Popover as PopoverPrimitive } from "radix-ui"

import { cn } from "@/lib/cn"

function Popover({
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Root>) {
  return <PopoverPrimitive.Root data-slot="popover" {...props} />
}

function PopoverTrigger({
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Trigger>) {
  return <PopoverPrimitive.Trigger data-slot="popover-trigger" {...props} />
}

function PopoverContent({
  className,
  align = "center",
  sideOffset = 4,
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Content>) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        data-slot="popover-content"
        align={align}
        sideOffset={sideOffset}
        className={cn(
          "z-50 w-72 origin-(--radix-popover-content-transform-origin) rounded-md border bg-popover p-4 text-popover-foreground shadow-md outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2",
          className
        )}
        {...props}
      />
    </PopoverPrimitive.Portal>
  )
}

function PopoverAnchor({
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Anchor>) {
  return <PopoverPrimitive.Anchor data-slot="popover-anchor" {...props} />
}

export { Popover, PopoverTrigger, PopoverContent, PopoverAnchor }
```

- [ ] **Step 2: Typecheck**

Run: `pnpm lint`
Expected: PASS (no errors). Confirms the `radix-ui` `Popover` export and theme tokens resolve.

- [ ] **Step 3: Commit**

```bash
git add src/components/ui/popover.tsx
git commit -m "feat(ui): add shadcn Popover primitive (radix-ui)"
```

---

## Task 2: Value cell becomes a focus-to-expand textarea

**Files:**
- Modify: `src/features/envs/VariablesTable.tsx`
- Test: `src/features/envs/VariablesTable.test.tsx`

- [ ] **Step 1: Write the failing test**

Append to `src/features/envs/VariablesTable.test.tsx` (inside the existing `describe("VariablesTable", …)` block):

```tsx
  it("renders value cells as multiline-capable textareas", () => {
    render(<VariablesTable value={{ token: "abc123" }} onChange={() => {}} />);
    const valueEl = screen.getByDisplayValue("abc123");
    expect(valueEl.tagName).toBe("TEXTAREA");
  });

  it("keeps the key cell a single-line input", () => {
    render(<VariablesTable value={{ token: "abc123" }} onChange={() => {}} />);
    const keyEl = screen.getByDisplayValue("token");
    expect(keyEl.tagName).toBe("INPUT");
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test src/features/envs/VariablesTable.test.tsx`
Expected: FAIL — `expected 'INPUT' to be 'TEXTAREA'` (value cell is still an `<Input>`).

- [ ] **Step 3: Implement the `ValueCell` textarea**

In `src/features/envs/VariablesTable.tsx`:

(a) Update the React import and add `cn`:

```tsx
import { Fragment, useLayoutEffect, useRef, useState } from "react";

import { cn } from "@/lib/cn";
```

(b) Below the existing `CELL_INPUT_CLASS` constant, add the cap constant and the `ValueCell` component:

```tsx
// Cap an expanded value at ~7 lines before it scrolls internally — a long JWT
// must not be able to blow up the dialog height.
const VALUE_MAX_PX = 168;

/** Value editor cell. Blurred: one clipped line (reads like the old single-line
 *  input). Focused: wraps and auto-grows to fit content, capped at VALUE_MAX_PX,
 *  then scrolls. `scrollHeight` is 0 under jsdom, so the grow is a live-only
 *  behaviour — tests assert this is a <textarea>, not its height. */
function ValueCell({
  value,
  onChange,
  disabled,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  placeholder?: string;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [focused, setFocused] = useState(false);

  // Grow to fit (capped) while focused; collapse back to the one-row CSS height
  // when blurred. Re-runs on value changes so typing keeps the height in sync.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (focused) {
      el.style.height = "auto";
      el.style.height = `${Math.min(el.scrollHeight, VALUE_MAX_PX)}px`;
    } else {
      el.style.height = "";
    }
  }, [focused, value]);

  return (
    <textarea
      ref={ref}
      rows={1}
      value={value}
      disabled={disabled}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      className={cn(
        CELL_INPUT_CLASS,
        "resize-none py-2 align-top",
        focused
          ? "overflow-y-auto whitespace-pre-wrap break-all"
          : "overflow-hidden whitespace-nowrap",
      )}
    />
  );
}
```

(c) Replace the value `<TableCell>` (currently the `<Input>` for `r.value`) with `ValueCell`, and switch the row cells to top alignment so a grown value keeps the key and delete button at the top:

```tsx
                  <TableCell className="p-0 align-top">
                    <Input
                      value={r.key}
                      onChange={(e) => updateRow(i, { key: e.target.value })}
                      placeholder={isTrailingEmpty ? "Add variable" : "key"}
                      className={CELL_INPUT_CLASS}
                    />
                  </TableCell>
                  <TableCell className="p-0 align-top border-l">
                    <ValueCell
                      value={r.value}
                      onChange={(v) => updateRow(i, { value: v })}
                      disabled={isTrailingEmpty}
                      placeholder={isTrailingEmpty ? "" : "value"}
                    />
                  </TableCell>
                  <TableCell className="w-9 p-0 align-top border-l text-center">
                    {isTrailingEmpty ? null : (
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        className="mt-1 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 text-muted-foreground hover:text-destructive"
                        onClick={() => deleteRow(i)}
                        aria-label={`delete variable ${r.key || "(unnamed)"}`}
                      >
                        ✕
                      </Button>
                    )}
                  </TableCell>
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm test src/features/envs/VariablesTable.test.tsx`
Expected: PASS — all 4 tests (2 existing + 2 new) green. The existing "Add variable" / duplicate-key tests still pass (key cell is unchanged; the `"Add variable"` placeholder still resolves).

- [ ] **Step 5: Commit**

```bash
git add src/features/envs/VariablesTable.tsx src/features/envs/VariablesTable.test.tsx
git commit -m "feat(envs): focus-to-expand textarea for variable values"
```

---

## Task 3: Identity-row layout + scaling frame + color popover

**Files:**
- Modify: `src/features/envs/EnvEditorDialog.tsx`
- Test: `src/features/envs/EnvEditorDialog.test.tsx`

- [ ] **Step 1: Write the failing tests**

Append to `src/features/envs/EnvEditorDialog.test.tsx` (inside the first `describe(...)` block, alongside the existing color test):

```tsx
  it("saves the color picked from the popover", async () => {
    const user = userEvent.setup();
    render(
      <EnvEditorDialog
        open
        originalName={null}
        activeEnv={null}
        envs={[]}
        onOpenChange={() => {}}
        onSaved={() => {}}
      />,
    );
    await user.type(screen.getByLabelText("Name"), "prod"); // name default = red
    await user.click(screen.getByRole("button", { name: "Environment color" }));
    await user.click(await screen.findByRole("button", { name: "Blue" }));
    await user.click(screen.getByRole("button", { name: /create/i }));
    expect(ipc.envUpsert).toHaveBeenCalledWith(
      expect.objectContaining({ name: "prod", color: "blue" }),
    );
  });

  it("dialog content is height-capped and column-flex (scales + internal scroll)", () => {
    render(
      <EnvEditorDialog
        open
        originalName={null}
        activeEnv={null}
        envs={[]}
        onOpenChange={() => {}}
        onSaved={() => {}}
      />,
    );
    const content = document.querySelector('[data-slot="dialog-content"]')!;
    expect(content.className).toContain("max-h-[85vh]");
    expect(content.className).toContain("flex-col");
  });

  it("the variables region scrolls internally", () => {
    render(
      <EnvEditorDialog
        open
        originalName={null}
        activeEnv={null}
        envs={[]}
        onOpenChange={() => {}}
        onSaved={() => {}}
      />,
    );
    const region = screen.getByText("Variables").closest("div")!;
    expect(region.className).toContain("overflow-auto");
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm test src/features/envs/EnvEditorDialog.test.tsx`
Expected: FAIL — the popover test errors on `getByRole("button", { name: "Environment color" })` (no such button yet); the frame tests fail on the missing `max-h-[85vh]` / `overflow-auto` classes.

- [ ] **Step 3: Implement the new dialog**

In `src/features/envs/EnvEditorDialog.tsx`:

(a) Add the popover import and extend the colors import with `colorHex`:

```tsx
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
```

```tsx
import { ENV_COLORS, colorHex, defaultColorKeyForName } from "./colors";
```

(b) Add a controlled open-state for the color popover next to the other `useState` hooks (so picking a swatch can close it):

```tsx
  const [colorOpen, setColorOpen] = useState(false);
```

(c) Replace the entire returned JSX (from `return (` to the closing `);`) with the new frame + identity row + popover. The `handleSave` logic and all derived values above it are unchanged:

```tsx
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] w-full max-w-[min(90vw,960px)] flex-col sm:max-w-[min(90vw,960px)]">
        <DialogHeader>
          <DialogTitle>{isCreate ? "New environment" : "Edit environment"}</DialogTitle>
          <DialogDescription className="sr-only">
            {isCreate
              ? "Create a new environment and define its variables."
              : "Rename or update variables."}
          </DialogDescription>
        </DialogHeader>

        {/* Identity row: name + color (pinned) */}
        <div className="space-y-1.5">
          <div className="flex items-center gap-2">
            <Input
              id="env-name"
              aria-label="Name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={cn("font-mono text-sm", nameIsDuplicate && "border-destructive")}
              aria-invalid={nameIsDuplicate}
              autoFocus
              placeholder="e.g. prod"
            />
            <Popover open={colorOpen} onOpenChange={setColorOpen}>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  aria-label="Environment color"
                  className="flex size-9 shrink-0 items-center justify-center rounded-md border border-input"
                >
                  <span
                    aria-hidden
                    className="size-5 rounded-full"
                    style={{ backgroundColor: colorHex(effectiveColor) }}
                  />
                </button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-auto p-2">
                <div className="flex max-w-[136px] flex-wrap gap-1.5">
                  {ENV_COLORS.map((c) => {
                    const selected = effectiveColor === c.key;
                    return (
                      <button
                        key={c.key}
                        type="button"
                        aria-label={c.label}
                        aria-pressed={selected}
                        onClick={() => {
                          setPickedColor(c.key);
                          setColorOpen(false);
                        }}
                        className={cn(
                          "size-6 rounded-full transition focus:outline-none",
                          selected
                            ? "ring-2 ring-foreground ring-offset-2 ring-offset-background"
                            : "hover:ring-2 hover:ring-muted-foreground hover:ring-offset-2 hover:ring-offset-background",
                        )}
                        style={{ backgroundColor: c.hex }}
                      />
                    );
                  })}
                </div>
              </PopoverContent>
            </Popover>
          </div>
          {nameIsDuplicate && (
            <p className="text-xs text-destructive mt-1">name already exists</p>
          )}
        </div>

        {/* Variables (scrolls internally) */}
        <div className="min-h-0 flex-1 space-y-1.5 overflow-auto">
          <Label>Variables</Label>
          <VariablesTable value={vars} onChange={setVars} />
        </div>

        {error && (
          <div className="border-l-2 border-destructive bg-destructive/5 px-3 py-1.5 text-xs text-destructive">
            {error}
          </div>
        )}

        <DialogFooter>
          {!isCreate && onRequestDelete && (
            <Button
              variant="ghost"
              onClick={() => onRequestDelete(originalName as string)}
              disabled={busy}
              className="mr-auto text-destructive hover:bg-destructive/10 hover:text-destructive"
            >
              Delete
            </Button>
          )}
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={!canSave || busy}>
            {busy ? "Saving…" : isCreate ? "Create" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
```

Note on the width classes: the base `DialogContent` sets `sm:max-w-lg` (512px). A non-prefixed `max-w-*` override does **not** beat a `sm:`-prefixed one in twMerge, so the `sm:max-w-[min(90vw,960px)]` is required as well — otherwise the dialog caps at 512px on `sm`+ screens. `flex` overrides the base `grid` (same display group, last wins); the base `gap-4` is retained as flex gap between the pinned regions.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm test src/features/envs/EnvEditorDialog.test.tsx`
Expected: PASS — all tests green, including the pre-existing name/rename/delete/default-color tests (`getByLabelText("Name")` resolves via the new `aria-label`; the default-color test never opens the popover).

- [ ] **Step 5: Commit**

```bash
git add src/features/envs/EnvEditorDialog.tsx src/features/envs/EnvEditorDialog.test.tsx
git commit -m "feat(envs): scaling dialog frame + identity-row layout + color popover"
```

---

## Task 4: Full verification + live WebView2 pass

**Files:** none (verification + any live-tuning fixes).

- [ ] **Step 1: Full FE suite**

Run: `pnpm test`
Expected: PASS — entire suite green (≥ the prior count; this plan adds 4 tests, removes none).

- [ ] **Step 2: Typecheck**

Run: `pnpm lint`
Expected: PASS (`tsc -b`, no errors).

- [ ] **Step 3: Build**

Run: `pnpm build`
Expected: PASS (`tsc -b && vite build` succeeds).

- [ ] **Step 4: Live verification in WebView2**

Run: `pnpm tauri:dev`. Open the env switcher (header pill) → gear (Edit) on an env, and verify:
1. **Scaling:** resize the main window — the dialog width tracks it (≈90vw) up to the ~960px cap, and shrinks on a small window. Never exceeds the cap; rows don't become absurdly long.
2. **Internal scroll:** add many variables (e.g. 20+). The variables list scrolls inside the dialog; the name+color row and the Save/Cancel footer stay pinned and visible. Dialog height never exceeds ~85vh.
3. **Long value:** paste a long JWT into a value cell — blurred it shows one clipped line; focused it wraps and grows, capped (~7 lines) then scrolls internally. The delete ✕ aligns to the top of a grown row.
4. **Color popover:** click the color dot → palette opens in a popover above the dialog overlay → pick a color → dot updates and popover closes → Save → reopen Edit and confirm the color persisted (marker dot in the switcher matches).
5. **Vertical alignment (visual tuning):** confirm the blurred value text baseline lines up with the key input. If off, tune the `ValueCell` `py-*`/`align-top` and the delete-button `mt-1` — these are the only pixel knobs.

- [ ] **Step 5: Commit any live-tuning fixes (if needed)**

```bash
git add -A
git commit -m "polish(envs): live-tune env editor spacing/alignment"
```

If no tuning was needed, skip this commit.

---

## Self-review notes (author)

- **Spec coverage:** S1 sizing → Task 3 frame + Task 4 live checks 1–2. L1 layout (identity row, color popover, sr-only description) → Task 3. B long values → Task 2 + Task 4 check 3. New `ui/popover` → Task 1. Tests kept-green + added → Tasks 2/3. Live-only behaviours (auto-grow, scroll, scaling) → Task 4. No spec requirement is unmapped.
- **No backend touched:** `Environment.variables` stays `HashMap<String,String>`; no IPC/bindings change.
- **Type consistency:** `ValueCell` prop names (`value`/`onChange`/`disabled`/`placeholder`) match the call site; `colorHex`/`effectiveColor` are existing symbols; `colorOpen`/`setColorOpen` are the only new state.
- **jsdom caveat:** `scrollHeight === 0` under jsdom → height/scroll/scaling are verified live (Task 4), structurally guarded by className assertions (Task 3).
