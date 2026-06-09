import { cn } from "@/lib/cn";

/**
 * Non-reflowing drop insertion indicator: a thin full-bleed tinted line at the
 * row's top (before) or bottom (after) edge. Absolutely positioned, so it never
 * shifts sibling rows — no drag oscillation. Inherits the row's --bl/--br bleed
 * vars so it spans to the sidebar edges.
 */
export function DropLine({ zone }: { zone: "before" | "after" }) {
  return (
    <span
      aria-hidden
      data-drop-line={zone}
      className={cn(
        "pointer-events-none absolute left-[var(--bl)] right-[var(--br)] z-10 h-[2px] rounded-full bg-primary",
        zone === "before" ? "top-0 -translate-y-1/2" : "bottom-0 translate-y-1/2",
      )}
    />
  );
}
