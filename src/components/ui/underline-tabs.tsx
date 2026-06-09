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
  /** Hide the active-tab indicator (e.g. while an in-flight progress bar owns the
   * underline). Avoids two competing marks on the same line. */
  busy?: boolean;
}

export function UnderlineTabs<T extends string>({
  value,
  onChange,
  items,
  className,
  busy = false,
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
          opacity: busy ? 0 : bar ? 1 : 0,
        }}
      />
    </div>
  );
}
