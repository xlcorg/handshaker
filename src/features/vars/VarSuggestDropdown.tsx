import { cn } from "@/lib/cn";
import type { VarCandidate } from "./candidates";

export interface VarSuggestDropdownProps {
  /** Visible (capped) candidates. */
  items: VarCandidate[];
  /** Total matches before the cap — drives the "…ещё M" hint + aria-setsize. */
  total: number;
  active: number;
  listboxId: string;
  onPick: (index: number) => void;
  /** px offset from the wrapper's left edge (caret-anchored at `{{`). */
  left: number;
}

export function optionId(listboxId: string, i: number): string {
  return `${listboxId}-opt-${i}`;
}

export function VarSuggestDropdown({ items, total, active, listboxId, onPick, left }: VarSuggestDropdownProps) {
  // No scroll: the list is capped and the hidden remainder is signalled by the hint row
  // (Baymard — keep the suggestion list short, narrow by typing).
  const hidden = total - items.length;
  return (
    <ul
      id={listboxId}
      role="listbox"
      className="absolute top-full z-50 mt-1 w-[min(22rem,90vw)] rounded-md border border-border bg-popover py-1 text-xs shadow-md"
      style={{ left }}
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
              c.origin === "env" ? "bg-emerald-500/15 text-emerald-400" : "bg-amber-500/15 text-amber-400",
            )}
          >
            {c.origin}
          </span>
          {c.overrides ? <span className="shrink-0 text-[10px] text-muted-foreground/50">overrides</span> : null}
        </li>
      ))}
      {hidden > 0 ? (
        // Non-option hint (keyboard nav skips it): the list is capped, not exhaustive.
        <li role="presentation" className="px-2.5 pt-1 text-[11px] text-muted-foreground/55">
          …ещё {hidden} — продолжай ввод
        </li>
      ) : null}
    </ul>
  );
}
