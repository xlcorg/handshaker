import { createPortal } from "react-dom";

import { cn } from "@/lib/cn";
import type { VarCandidate } from "./candidates";
import { messages } from "@/lib/messages";

export interface VarSuggestDropdownProps {
  /** Visible (capped) candidates. */
  items: VarCandidate[];
  /** Total matches before the cap — drives the "…ещё M" hint + aria-setsize. */
  total: number;
  active: number;
  listboxId: string;
  onPick: (index: number) => void;
  /** Viewport x of the caret (`{{` anchor) — the dropdown is `position: fixed`. */
  left: number;
  /** Viewport y just below the input. */
  top: number;
}

export function optionId(listboxId: string, i: number): string {
  return `${listboxId}-opt-${i}`;
}

export function VarSuggestDropdown({ items, total, active, listboxId, onPick, left, top }: VarSuggestDropdownProps) {
  // No scroll: the list is capped and the hidden remainder is signalled by the hint row
  // (Baymard — keep the suggestion list short, narrow by typing).
  const hidden = total - items.length;
  // Portal + `fixed` positioning so the list escapes any overflow-hidden/auto ancestor
  // (e.g. the metadata editor's bordered container), which would otherwise clip it to a
  // single visible row. This is the standard popover-in-overflow approach (Radix/Floating-UI).
  return createPortal(
    <ul
      id={listboxId}
      role="listbox"
      className="fixed z-50 w-[min(22rem,90vw)] rounded-md border border-border bg-popover py-1 text-xs shadow-md"
      style={{ left, top }}
    >
      {items.map((c, i) => (
        <li
          key={c.name}
          id={optionId(listboxId, i)}
          role="option"
          aria-selected={i === active}
          aria-setsize={total}
          aria-posinset={i + 1}
          // mousedown, not click: keep DOM focus on the input (no blur-close race)
          onMouseDown={(e) => {
            e.preventDefault();
            onPick(i);
          }}
          className={cn(
            "flex items-center gap-2 px-2.5 py-1 cursor-pointer",
            i === active ? "bg-accent" : "hover:bg-accent/60",
          )}
        >
          <span className="font-mono text-foreground">{c.name}</span>
          {c.value ? (
            <span className="min-w-0 flex-1 truncate font-mono text-muted-foreground/70">{c.value}</span>
          ) : (
            <span className="flex-1" />
          )}
          <span
            className={cn(
              "shrink-0 rounded px-1.5 py-px text-[10px]",
              c.origin === "env" ? "bg-ok/15 text-ok" : "bg-warn/15 text-warn",
            )}
          >
            {c.origin}
          </span>
          {c.overrides ? <span className="shrink-0 text-[10px] text-muted-foreground/55">overrides</span> : null}
        </li>
      ))}
      {hidden > 0 ? (
        // Non-option hint (keyboard nav skips it): the list is capped, not exhaustive.
        <li role="presentation" className="px-2.5 pt-1 text-[11px] text-muted-foreground/55">
          {messages.vars.suggest.moreResults(hidden)}
        </li>
      ) : null}
    </ul>,
    document.body,
  );
}
