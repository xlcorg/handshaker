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
