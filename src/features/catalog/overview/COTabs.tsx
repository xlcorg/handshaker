import { cn } from "@/lib/cn";

export interface COTabItem {
  value: string;
  label: string;
  hint?: number | null;
}

interface COTabsProps {
  value: string;
  onChange: (value: string) => void;
  items: COTabItem[];
}

export function COTabs({ value, onChange, items }: COTabsProps) {
  return (
    <div className="flex-none flex items-stretch gap-0.5 h-9 px-3 border-b border-border bg-card/40">
      {items.map((it) => {
        const active = it.value === value;
        return (
          <button
            key={it.value}
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
                  "font-mono text-[10px] tabular-nums rounded px-1 py-px",
                  active ? "bg-accent text-muted-foreground" : "text-muted-foreground/70",
                )}
              >
                {it.hint}
              </span>
            )}
            {active && (
              <span
                aria-hidden
                className="absolute left-2 right-2 -bottom-px h-[1.5px] rounded-full bg-foreground"
              />
            )}
          </button>
        );
      })}
    </div>
  );
}
