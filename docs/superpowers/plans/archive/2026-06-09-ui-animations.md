# UI animations Implementation Plan

> **Status: ✅ code-complete (2026-06-09).** All 6 implementation tasks done, committed, and reviewed (per-task spec+quality review + final holistic review). Verification: `pnpm test` 611/611, `pnpm lint` (tsc) clean, `pnpm build` clean — all on branch `claude/serene-feistel-e53ca1` (commits `4db8b83`…`2cf658e`). **Deferred to a human:** manual `pnpm tauri dev` visual pass (tab-indicator slide, drop slot, group fill), `prefers-reduced-motion` toggle check, and the macOS/WKWebView visual pass.
>
> **Post-review follow-up (commit `b7cd1ea`, supersedes parts of §3 below).** A live `pnpm tauri dev` review changed two things from the plan as written: (1) the reflowing `DropSlot` placeholder was replaced by a non-reflowing tinted insertion line (`DropLine`) — the row-pushing reflow oscillated under the cursor; `DropSlot` was removed. (2) Added a forgiving collection-body drop target, a transform-only "comet" rewrite of `hs-tab-progress` (was layout-animated `left`/`width`) that grows out of the active tab on its first pass, a `prefers-reduced-motion` fallback for it, a ~250ms show delay (fast responses no longer flash), and a `busy` fade of the tab underline while the comet runs. Tests now 614.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a shared motion-tokens + `prefers-reduced-motion` baseline, a sliding underline indicator for tabs (B), and a Claude-Desktop-style tinted drop affordance for the sidebar drag-and-drop (E).

**Architecture:** Pure native + CSS, no new dependencies. Motion tokens (durations/easing) live as CSS variables in `globals.css` with a global reduced-motion reset that keeps essential loaders alive. The tab indicator becomes one measured, `transform`-driven bar in `UnderlineTabs`. The DnD drop hint switches from a 2px inset line to a reusable tinted `DropSlot` placeholder (before/after) plus a fill-tinted container region (inside); the existing `planDrop`/`dropHint` logic is untouched.

**Tech Stack:** React 18, TypeScript, Tailwind CSS v4, Vitest + Testing Library (jsdom), Tauri 2 (WebView2/WKWebView).

**Spec:** [docs/superpowers/specs/2026-06-09-ui-animations-design.md](../specs/2026-06-09-ui-animations-design.md)

**Branch:** `claude/serene-feistel-e53ca1`

---

## File Structure

- Modify: [`src/styles/globals.css`](../../../src/styles/globals.css) — motion tokens, reduced-motion reset, slot/indicator transition helpers (Task 1).
- Modify: [`src/components/ui/underline-tabs.tsx`](../../../src/components/ui/underline-tabs.tsx) — sliding indicator (Task 2).
- Create: `src/components/ui/underline-tabs.test.tsx` — indicator tests (Task 2).
- Create: [`src/features/catalog/DropSlot.tsx`](../../../src/features/catalog) — tinted placeholder (Task 3).
- Create: `src/features/catalog/DropSlot.test.tsx` (Task 3).
- Modify: [`src/features/catalog/RequestRow.tsx`](../../../src/features/catalog/RequestRow.tsx) — before/after slots (Task 4).
- Modify: [`src/features/catalog/RequestRow.test.tsx`](../../../src/features/catalog/RequestRow.test.tsx) (Task 4).
- Modify: [`src/features/catalog/FolderNode.tsx`](../../../src/features/catalog/FolderNode.tsx) — before/after slots + inside fill (Task 5).
- Modify: [`src/features/catalog/FolderNode.test.tsx`](../../../src/features/catalog/FolderNode.test.tsx) (Task 5).
- Modify: [`src/features/catalog/CollectionNode.tsx`](../../../src/features/catalog/CollectionNode.tsx) — inside fill (Task 6).
- Modify: [`src/features/catalog/CollectionNode.test.tsx`](../../../src/features/catalog/CollectionNode.test.tsx) (Task 6).

**Commands used throughout:**
- One test file: `pnpm exec vitest run <path>`
- Full suite: `pnpm test`
- Typecheck/lint: `pnpm lint`
- Build (Tailwind compiles tokens): `pnpm build`

---

### Task 1: Motion tokens + reduced-motion baseline

**Files:**
- Modify: `src/styles/globals.css`

This task is CSS-only — there is no unit test (jsdom cannot evaluate `@media (prefers-reduced-motion)` or compute Tailwind output). It is verified by `pnpm build` (Tailwind must still compile) and manual inspection. Subsequent tasks consume these tokens.

- [ ] **Step 1: Add motion tokens to `:root`**

In `src/styles/globals.css`, find the line `  --radius: 0.5rem;` inside the `:root {` block (around line 67) and insert the motion tokens immediately after it:

```css
  --radius: 0.5rem;

  /* motion tokens — desktop-snappy durations + Material-derived easing */
  --motion-fast: 120ms;
  --motion-base: 180ms;
  --ease-standard: cubic-bezier(.2, 0, 0, 1); /* movement between states */
  --ease-out: cubic-bezier(0, 0, .2, 1);      /* enter (decelerate) */
  --ease-in: cubic-bezier(.4, 0, 1, 1);       /* exit (accelerate) */
```

- [ ] **Step 2: Add the slot/indicator transition helpers + drop-slot keyframe**

In `src/styles/globals.css`, find the streaming pulse block:

```css
/* streaming pulse */
.pulse-dot { animation: hs-pulse 1.4s ease-in-out infinite; }
@keyframes hs-pulse { 0%, 100% { opacity: 1; } 50% { opacity: .35; } }
```

Insert directly **after** it:

```css
/* sliding tab underline (B) — width/position transition, enabled after first measure */
.hs-tab-indicator {
  transition: transform var(--motion-fast) var(--ease-standard),
              width var(--motion-fast) var(--ease-standard);
}

/* DnD drop slot (E) — tinted placeholder fades in at the insertion point */
.hs-slot-enter { animation: hs-slot-in var(--motion-fast) var(--ease-out); }
@keyframes hs-slot-in { from { opacity: 0; } to { opacity: 1; } }
```

- [ ] **Step 3: Add the global reduced-motion reset**

In `src/styles/globals.css`, find the `::selection` rule near the bottom:

```css
::selection { background: hsl(var(--foreground) / .15); }
```

Insert directly **before** it:

```css
/* Accessibility: honour the OS "reduce motion" setting (WCAG 2.3.3). Neutralise
   all transitions/animations, but keep essential status feedback (loading spinner,
   streaming pulse) animated — they convey state, not decoration. */
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: .01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: .01ms !important;
  }
  .spinner   { animation-duration: .8s  !important; animation-iteration-count: infinite !important; }
  .pulse-dot { animation-duration: 1.4s !important; animation-iteration-count: infinite !important; }
}
```

- [ ] **Step 4: Verify the build still compiles**

Run: `pnpm build`
Expected: build succeeds (tsc + vite), no CSS errors.

- [ ] **Step 5: Commit**

```bash
git add src/styles/globals.css
git commit -m "feat(motion): add motion tokens + prefers-reduced-motion baseline"
```

---

### Task 2: Sliding tab indicator (B)

**Files:**
- Modify: `src/components/ui/underline-tabs.tsx`
- Test: `src/components/ui/underline-tabs.test.tsx`

Replace the per-tab opacity-faded `<span>` underline with a single bar measured from the active tab and moved via `transform`. jsdom reports `offsetLeft/offsetWidth === 0`, so tests assert the indicator exists exactly once and tracks the active tab — not pixel position.

- [ ] **Step 1: Write the failing test**

Create `src/components/ui/underline-tabs.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { UnderlineTabs } from "./underline-tabs";

const items = [
  { value: "a", label: "Alpha" },
  { value: "b", label: "Beta" },
] as const;

describe("UnderlineTabs", () => {
  it("renders exactly one sliding indicator", () => {
    render(<UnderlineTabs value="a" onChange={() => {}} items={items} />);
    expect(screen.getAllByTestId("tab-indicator")).toHaveLength(1);
  });

  it("marks the active tab with aria-selected", () => {
    render(<UnderlineTabs value="a" onChange={() => {}} items={items} />);
    expect(screen.getByRole("tab", { name: "Alpha" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("tab", { name: "Beta" }).getAttribute("aria-selected")).toBe("false");
  });

  it("fires onChange with the clicked tab value", () => {
    const onChange = vi.fn();
    render(<UnderlineTabs value="a" onChange={onChange} items={items} />);
    fireEvent.click(screen.getByRole("tab", { name: "Beta" }));
    expect(onChange).toHaveBeenCalledWith("b");
  });

  it("moves aria-selected when the value changes", () => {
    const { rerender } = render(<UnderlineTabs value="a" onChange={() => {}} items={items} />);
    rerender(<UnderlineTabs value="b" onChange={() => {}} items={items} />);
    expect(screen.getByRole("tab", { name: "Beta" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getAllByTestId("tab-indicator")).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm exec vitest run src/components/ui/underline-tabs.test.tsx`
Expected: FAIL — `getByTestId("tab-indicator")` finds nothing (indicator doesn't exist yet).

- [ ] **Step 3: Rewrite `underline-tabs.tsx` with the sliding indicator**

Replace the entire contents of `src/components/ui/underline-tabs.tsx` with:

```tsx
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { cn } from "@/lib/cn";

export interface UnderlineTabItem<T extends string = string> {
  value: T;
  label: string;
  hint?: string | number;
}

export interface UnderlineTabsProps<T extends string> {
  value: T;
  onChange: (next: T) => void;
  items: ReadonlyArray<UnderlineTabItem<T>>;
  className?: string;
}

export function UnderlineTabs<T extends string>({
  value,
  onChange,
  items,
  className,
}: UnderlineTabsProps<T>) {
  const listRef = useRef<HTMLDivElement>(null);
  const [bar, setBar] = useState<{ left: number; width: number } | null>(null);
  // Transition is enabled only after the first measurement, so the bar doesn't
  // "fly in" from 0 on mount.
  const [animate, setAnimate] = useState(false);

  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const measure = () => {
      const active = list.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]');
      if (!active) return;
      // The underline is inset 8px on each side of the tab (matches the old left-2/right-2,
      // and the response progress-bar's +8 offset in ResponsePanel).
      setBar({ left: active.offsetLeft + 8, width: Math.max(0, active.offsetWidth - 16) });
    };
    measure();
    let ro: ResizeObserver | undefined;
    if (typeof ResizeObserver !== "undefined") {
      ro = new ResizeObserver(measure);
      ro.observe(list);
    }
    return () => ro?.disconnect();
  }, [value, items]);

  useEffect(() => {
    setAnimate(true);
  }, []);

  return (
    <div
      ref={listRef}
      role="tablist"
      className={cn("relative self-stretch flex items-stretch gap-0.5", className)}
    >
      {items.map((it) => {
        const active = it.value === value;
        return (
          <button
            key={it.value}
            role="tab"
            aria-selected={active}
            onClick={() => onChange(it.value)}
            className={cn(
              "relative inline-flex items-center gap-1.5 px-2.5 text-[12.5px] transition-colors focus:outline-none",
              active ? "text-foreground" : "text-muted-foreground hover:text-foreground",
            )}
          >
            <span>{it.label}</span>
            {it.hint != null && (
              <span
                className={cn(
                  "font-mono text-[10px] tabular-nums",
                  active ? "text-muted-foreground" : "text-muted-foreground/60",
                )}
              >
                {it.hint}
              </span>
            )}
          </button>
        );
      })}
      <span
        aria-hidden
        data-testid="tab-indicator"
        className={cn(
          "pointer-events-none absolute left-0 -bottom-px h-[1.5px] rounded-full bg-foreground",
          animate && "hs-tab-indicator",
        )}
        style={{
          width: bar?.width ?? 0,
          transform: `translateX(${bar?.left ?? 0}px)`,
          opacity: bar ? 1 : 0,
        }}
      />
    </div>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm exec vitest run src/components/ui/underline-tabs.test.tsx`
Expected: PASS (4 tests).

- [ ] **Step 5: Verify consumers still typecheck**

Run: `pnpm lint`
Expected: PASS — `RequestTabs` and `ResponsePanel` use the same `UnderlineTabs` API (unchanged props).

- [ ] **Step 6: Commit**

```bash
git add src/components/ui/underline-tabs.tsx src/components/ui/underline-tabs.test.tsx
git commit -m "feat(tabs): sliding underline indicator"
```

---

### Task 3: `DropSlot` component (E foundation)

**Files:**
- Create: `src/features/catalog/DropSlot.tsx`
- Test: `src/features/catalog/DropSlot.test.tsx`

A reusable tinted-fill placeholder (style A) rendered at the drop insertion point. It is an `<li>` (so it fits inside `SidebarMenuSub`) that reserves a row's height and paints a full-bleed fill via `::before`, matching the row bleed math.

- [ ] **Step 1: Write the failing test**

Create `src/features/catalog/DropSlot.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { DropSlot } from "./DropSlot";
import { SidebarProvider } from "@/components/ui/sidebar";

describe("DropSlot", () => {
  it("renders a hidden li flagged with data-drop-slot", () => {
    render(
      <SidebarProvider>
        <DropSlot depth={1} />
      </SidebarProvider>,
    );
    const slot = document.querySelector("[data-drop-slot]");
    expect(slot).not.toBeNull();
    expect(slot!.tagName).toBe("LI");
    expect(slot!.getAttribute("aria-hidden")).toBe("true");
  });

  it("applies depth-scaled bleed offsets (depth 2 → --bl -33px)", () => {
    render(
      <SidebarProvider>
        <DropSlot depth={2} />
      </SidebarProvider>,
    );
    const slot = document.querySelector("[data-drop-slot]") as HTMLElement;
    // bleedStyle: 3 - depth*18 = 3 - 36 = -33
    expect(slot.style.getPropertyValue("--bl")).toBe("-33px");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm exec vitest run src/features/catalog/DropSlot.test.tsx`
Expected: FAIL — module `./DropSlot` does not exist.

- [ ] **Step 3: Create `DropSlot.tsx`**

Create `src/features/catalog/DropSlot.tsx`:

```tsx
import { SidebarMenuSubItem } from "@/components/ui/sidebar";
import { bleedStyle } from "./bleed";

/**
 * Tinted-fill placeholder shown at the drop insertion point during a sidebar drag
 * (style A — fill, no border). It reserves a row's height so neighbours shift apart,
 * and paints a full-bleed fill via `::before`, mirroring the row bleed math.
 */
export function DropSlot({ depth = 1 }: { depth?: number }) {
  return (
    <SidebarMenuSubItem
      aria-hidden
      data-drop-slot
      style={bleedStyle(depth)}
      className={
        "hs-slot-enter relative isolate h-6 " +
        "before:pointer-events-none before:absolute before:inset-y-0.5 " +
        "before:left-[var(--bl)] before:right-[var(--br)] before:-z-10 " +
        "before:rounded-md before:bg-primary/15 before:content-['']"
      }
    />
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm exec vitest run src/features/catalog/DropSlot.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/features/catalog/DropSlot.tsx src/features/catalog/DropSlot.test.tsx
git commit -m "feat(dnd): tinted DropSlot placeholder component"
```

---

### Task 4: Wire `DropSlot` into `RequestRow` (before/after)

**Files:**
- Modify: `src/features/catalog/RequestRow.tsx`
- Test: `src/features/catalog/RequestRow.test.tsx`

Render a `DropSlot` before/after the row based on the drop hint, and remove the old 2px inset-shadow line.

- [ ] **Step 1: Add the failing tests**

In `src/features/catalog/RequestRow.test.tsx`, add these tests inside the `describe("RequestRow", …)` block (before its closing `});`):

```tsx
  it("renders a drop slot before the row when dropHint zone is 'before'", () => {
    renderWithSidebar(
      <RequestRow collectionId="c1" req={req("R")} cb={makeCb({ dropHint: { id: "r1", zone: "before" } })} />,
    );
    const slot = document.querySelector("[data-drop-slot]");
    expect(slot).not.toBeNull();
    // the slot's next sibling wraps the request row
    expect(slot!.nextElementSibling?.querySelector("[data-node-id='r1']")).toBeTruthy();
  });

  it("renders a drop slot after the row when dropHint zone is 'after'", () => {
    renderWithSidebar(
      <RequestRow collectionId="c1" req={req("R")} cb={makeCb({ dropHint: { id: "r1", zone: "after" } })} />,
    );
    const rowLi = document.querySelector("[data-node-id='r1']")!.closest("[data-slot='sidebar-menu-sub-item']");
    expect(rowLi?.nextElementSibling?.hasAttribute("data-drop-slot")).toBe(true);
  });

  it("renders no drop slot when dropHint is null", () => {
    renderWithSidebar(<RequestRow collectionId="c1" req={req("R")} cb={makeCb()} />);
    expect(document.querySelector("[data-drop-slot]")).toBeNull();
  });

  it("renders no drop slot when dropHint targets another row", () => {
    renderWithSidebar(
      <RequestRow collectionId="c1" req={req("R")} cb={makeCb({ dropHint: { id: "other", zone: "before" } })} />,
    );
    expect(document.querySelector("[data-drop-slot]")).toBeNull();
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm exec vitest run src/features/catalog/RequestRow.test.tsx`
Expected: FAIL — the "before"/"after" tests fail because no `[data-drop-slot]` is rendered.

- [ ] **Step 3: Import `DropSlot` and wrap the row with before/after slots**

In `src/features/catalog/RequestRow.tsx`, add the import after the `RenameInput` import (line 6):

```tsx
import { DropSlot } from "./DropSlot";
```

Then change the top-level `return (` so the `<SidebarMenuSubItem>` is wrapped in a fragment with conditional slots. Replace this line:

```tsx
  return (
    <SidebarMenuSubItem>
```

with:

```tsx
  return (
    <>
      {hint === "before" && <DropSlot depth={depth} />}
      <SidebarMenuSubItem>
```

And replace the matching closing line:

```tsx
    </SidebarMenuSubItem>
  );
}
```

with:

```tsx
      </SidebarMenuSubItem>
      {hint === "after" && <DropSlot depth={depth} />}
    </>
  );
}
```

- [ ] **Step 4: Remove the old inset-shadow hint classes**

In the same file, in the inner row `<div>`'s `className={cn(...)}` list, delete these two lines:

```tsx
                hint === "before" && "shadow-[inset_0_2px_0_0_hsl(var(--primary))]",
                hint === "after" && "shadow-[inset_0_-2px_0_0_hsl(var(--primary))]",
```

(Keep `cb.dragId === req.id && "opacity-50"` and `data-drop={hint ?? undefined}` — the dragged "ghost" and the hint attribute stay.)

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm exec vitest run src/features/catalog/RequestRow.test.tsx`
Expected: PASS (all original tests + 4 new).

- [ ] **Step 6: Commit**

```bash
git add src/features/catalog/RequestRow.tsx src/features/catalog/RequestRow.test.tsx
git commit -m "feat(dnd): DropSlot before/after on request rows"
```

---

### Task 5: `FolderNode` before/after slots + inside fill tint

**Files:**
- Modify: `src/features/catalog/FolderNode.tsx`
- Test: `src/features/catalog/FolderNode.test.tsx`

Folders are reorderable (before/after) AND droppable into (inside). Add slots like the request row, and switch the inside affordance from `ring + bg-primary/5` to a style-A fill on both the header row and the open children container.

- [ ] **Step 1: Add the failing tests**

In `src/features/catalog/FolderNode.test.tsx`, add inside the `describe("FolderNode", …)` block (before its closing `});`):

```tsx
  it("renders a drop slot before the folder when dropHint zone is 'before'", () => {
    renderWithSidebar(
      <FolderNode collectionId="c1" folder={folder} cb={makeCb({ dropHint: { id: "f1", zone: "before" } })} />,
    );
    const slot = document.querySelector("[data-drop-slot]");
    expect(slot).not.toBeNull();
    expect(slot!.nextElementSibling?.querySelector("[data-node-id='f1']")).toBeTruthy();
  });

  it("fills the folder row with a tint when dropHint zone is 'inside'", () => {
    renderWithSidebar(
      <FolderNode collectionId="c1" folder={folder} cb={makeCb({ dropHint: { id: "f1", zone: "inside" } })} />,
    );
    const row = document.querySelector("[data-node-id='f1']") as HTMLElement;
    expect(row.className).toContain("bg-primary/10");
  });

  it("does not fill the row when not the drop target", () => {
    renderWithSidebar(
      <FolderNode collectionId="c1" folder={folder} cb={makeCb({ dropHint: { id: "other", zone: "inside" } })} />,
    );
    const row = document.querySelector("[data-node-id='f1']") as HTMLElement;
    expect(row.className).not.toContain("bg-primary/10");
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm exec vitest run src/features/catalog/FolderNode.test.tsx`
Expected: FAIL — no `[data-drop-slot]`, and the row uses the old `bg-primary/5`, not `bg-primary/10`.

- [ ] **Step 3: Import `DropSlot`**

In `src/features/catalog/FolderNode.tsx`, add after the `RequestRow` import (line 7):

```tsx
import { DropSlot } from "./DropSlot";
```

- [ ] **Step 4: Swap the inside hint class to a style-A fill**

In the header `<div>`'s `className={cn(...)}`, replace this line:

```tsx
            hint === "inside" && "ring-1 ring-inset ring-primary bg-primary/5",
```

with:

```tsx
            hint === "inside" && "bg-primary/10",
```

And delete the two before/after shadow lines:

```tsx
            hint === "before" && "shadow-[inset_0_2px_0_0_hsl(var(--primary))]",
            hint === "after" && "shadow-[inset_0_-2px_0_0_hsl(var(--primary))]",
```

- [ ] **Step 5: Tint the open children container on inside, and add before/after slots**

In `src/features/catalog/FolderNode.tsx`, change the open-children block. Replace:

```tsx
      {open ? (
        <SidebarMenuSub className="mx-2 gap-0.5 px-2 py-0 border-transparent hover:border-sidebar-border">
```

with:

```tsx
      {open ? (
        <SidebarMenuSub
          className={cn(
            "mx-2 gap-0.5 px-2 py-0 border-transparent hover:border-sidebar-border",
            hint === "inside" && "rounded-md bg-primary/5",
          )}
        >
```

Then wrap the returned `<SidebarMenuSubItem>` in a fragment with slots. Replace:

```tsx
  return (
    <SidebarMenuSubItem>
      <RowMenu items={items} depth={depth}>
```

with:

```tsx
  return (
    <>
      {hint === "before" && <DropSlot depth={depth} />}
      <SidebarMenuSubItem>
        <RowMenu items={items} depth={depth}>
```

And replace the closing of that item — these lines:

```tsx
      ) : null}
    </SidebarMenuSubItem>
  );
}
```

with:

```tsx
      ) : null}
      </SidebarMenuSubItem>
      {hint === "after" && <DropSlot depth={depth} />}
    </>
  );
}
```

> Note: the `</RowMenu>` and the `{open ? (...) : null}` children block in between are unchanged — only the outermost wrapper and indentation shift. Re-run the formatter if indentation drifts (`pnpm format`).

- [ ] **Step 6: Run the tests to verify they pass**

Run: `pnpm exec vitest run src/features/catalog/FolderNode.test.tsx`
Expected: PASS (all original tests + 3 new).

- [ ] **Step 7: Commit**

```bash
git add src/features/catalog/FolderNode.tsx src/features/catalog/FolderNode.test.tsx
git commit -m "feat(dnd): folder before/after slots + inside fill tint"
```

---

### Task 6: `CollectionNode` inside fill tint

**Files:**
- Modify: `src/features/catalog/CollectionNode.tsx`
- Test: `src/features/catalog/CollectionNode.test.tsx`

Collections only accept the `inside` zone (see `zoneFromPointer`), so no slots — just switch the inside affordance to a style-A fill on the header row and the open children container.

- [ ] **Step 1: Add the failing tests**

In `src/features/catalog/CollectionNode.test.tsx`, add inside the `describe("CollectionNode", …)` block (before its closing `});`):

```tsx
  it("fills the collection row with a tint when dropHint zone is 'inside'", () => {
    renderWithSidebar(<CollectionNode col={col()} cb={makeCb({ dropHint: { id: "c1", zone: "inside" } })} />);
    const row = document.querySelector("[data-node-id='c1']") as HTMLElement;
    expect(row.className).toContain("bg-primary/10");
  });

  it("does not fill the row when not the drop target", () => {
    renderWithSidebar(<CollectionNode col={col()} cb={makeCb({ dropHint: { id: "other", zone: "inside" } })} />);
    const row = document.querySelector("[data-node-id='c1']") as HTMLElement;
    expect(row.className).not.toContain("bg-primary/10");
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm exec vitest run src/features/catalog/CollectionNode.test.tsx`
Expected: FAIL — the row uses the old `bg-primary/5`, not `bg-primary/10`.

- [ ] **Step 3: Swap the inside hint class to a style-A fill**

In `src/features/catalog/CollectionNode.tsx`, in the header `<div>`'s `className={cn(...)}`, replace this line:

```tsx
            hint === "inside" && "ring-1 ring-inset ring-primary bg-primary/5",
```

with:

```tsx
            hint === "inside" && "bg-primary/10",
```

- [ ] **Step 4: Tint the open children container on inside**

In the same file, replace:

```tsx
      {open ? (
        <SidebarMenuSub className="mx-2 gap-0.5 px-2 py-0 border-transparent hover:border-sidebar-border">
```

with:

```tsx
      {open ? (
        <SidebarMenuSub
          className={cn(
            "mx-2 gap-0.5 px-2 py-0 border-transparent hover:border-sidebar-border",
            hint === "inside" && "rounded-md bg-primary/5",
          )}
        >
```

(`cn` is already imported in this file.)

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm exec vitest run src/features/catalog/CollectionNode.test.tsx`
Expected: PASS (all original tests + 2 new).

- [ ] **Step 6: Commit**

```bash
git add src/features/catalog/CollectionNode.tsx src/features/catalog/CollectionNode.test.tsx
git commit -m "feat(dnd): collection inside fill tint"
```

---

### Task 7: Full verification + manual checklist

**Files:** none (verification only)

- [ ] **Step 1: Run the full test suite**

Run: `pnpm test`
Expected: PASS — all suites green (prior count + the new indicator/DropSlot/row/folder/collection tests).

- [ ] **Step 2: Typecheck**

Run: `pnpm lint`
Expected: PASS (tsc clean).

- [ ] **Step 3: Build**

Run: `pnpm build`
Expected: PASS.

- [ ] **Step 4: Manual verification (document results, do not auto-claim)**

Run: `pnpm tauri dev` (WebView2 on Windows) and verify:
- Switching Request/Metadata/Auth and Body/Trailers/Headers tabs → the underline **slides** between tabs (no fade), no fly-in on first open.
- Dragging a request/folder between siblings → a **tinted fill slot** opens at the insertion point and neighbours shift; dropping moves correctly (unchanged behaviour).
- Dragging over a folder/collection → the **whole group region** fills with a tint (header + children).
- OS "Reduce motion" ON (Windows: Settings → Accessibility → Visual effects → Animation effects off) → tab indicator jumps instantly, slot appears without fade; the loading spinner and streaming pulse still animate.

macOS/WKWebView visual pass is **deferred**, consistent with the project's other deferred mac checks.

- [ ] **Step 5: Archive the spec + plan (feature complete)**

Per `CLAUDE.md`, once all tasks are committed and verified, move the plan and spec to `archive/` in one commit:

```bash
git mv docs/superpowers/plans/2026-06-09-ui-animations.md docs/superpowers/plans/archive/
git mv docs/superpowers/specs/2026-06-09-ui-animations-design.md docs/superpowers/specs/archive/
git commit -m "docs(archive): UI animations plan+spec"
```

Then update the "Active work" / "Завершённые фичи" section in `CLAUDE.md`.

---

## Self-Review

**Spec coverage:**
- Motion tokens + reduced-motion (spec §1) → Task 1. ✓
- Sliding tab indicator (spec §2) → Task 2. ✓
- DropSlot before/after + inside region tint (spec §3) → Tasks 3–6. ✓
- `planDrop`/`dropHint` untouched (spec §Approach) → no task modifies `dnd.ts` or `CollectionTree` drop logic. ✓
- Testing approach (spec §Testing): jsdom-safe assertions (existence/aria, not pixels) → Tasks 2–6; reduced-motion + cross-engine manual → Task 7. ✓

**Deviations from spec (intentional):**
- Spec §3 mentioned a `max-height`/opacity transition for the slot; the plan uses **opacity-only** fade (`hs-slot-in`) with the height reserved instantly by `h-6`. Reason: `max-height` is a layout-animated property the spec's own §1 rule discourages; opacity is compositor-friendly and the neighbour shift is still immediate. Visual result matches "slot opens, neighbours move".
- Spec §Testing assumed existing tests asserted the old inset-shadow hint and would need updating. They do **not** (verified) — so no removals are needed, only additive tests. The old shadow classes are still removed from the components (Tasks 4–5) since the slot replaces them.
- Inside affordance changed from `ring + bg-primary/5` to fill `bg-primary/10` (header) + `bg-primary/5` (children) to honour the chosen style A (fill, no border).

**Placeholder scan:** none — every code/edit step contains concrete content.

**Type consistency:** `DropSlot({ depth })`, `bleedStyle(depth)`, `cb.dropHint.zone` (`"before" | "after" | "inside"`), `data-drop-slot`, `data-testid="tab-indicator"`, `hs-slot-enter` / `hs-tab-indicator` classes — all used consistently across tasks and match existing `treeTypes.ts` / `dnd.ts` / `bleed.ts`.
