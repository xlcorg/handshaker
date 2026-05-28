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
  return (
    <div role="tablist" className={cn("self-stretch flex items-stretch gap-0.5", className)}>
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
            <span
              aria-hidden
              className={cn(
                "absolute left-2 right-2 -bottom-px h-[1.5px] rounded-full bg-foreground transition-opacity",
                active ? "opacity-100" : "opacity-0",
              )}
            />
          </button>
        );
      })}
    </div>
  );
}
