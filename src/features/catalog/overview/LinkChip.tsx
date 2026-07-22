import { Pencil, Plus } from "lucide-react";
import { cn } from "@/lib/cn";
import { messages } from "@/lib/messages";
import { type LinkResolve, type LinkRow, linkLabel, openLink, useLinkTarget } from "./linkTarget";

const m = messages.catalog.overview.links;

/** One read-only link chip, shared by the strip, header, and overflow-menu variants.
 *  Rendered as plain hyperlink-styled text — no icon, no border — so it reads as a link.
 *  Reuses the shared classification so all mark identically: `ready` accent-colored,
 *  underline-on-hover, pointer cursor (title = resolved URL); `broken` red, inert, no
 *  underline (title = missing vars / cycle); `pending` muted and inert. */
export function LinkChip({ row, resolveUrl, resolveKey }: { row: LinkRow } & LinkResolve) {
  const target = useLinkTarget(row.url, resolveUrl, resolveKey);
  const label = linkLabel(row.name, row.url);

  return (
    // Native `title` (not the Tooltip wrapper): the hover text is the resolved URL — or
    // the missing vars — and must stay readable on a blocked, non-interactive chip.
    <button
      type="button"
      onClick={() => target.kind === "ready" && openLink(target.url)}
      aria-disabled={target.kind !== "ready"}
      title={target.title}
      className={cn(
        "inline-flex h-6 max-w-[180px] items-center text-[12px] underline-offset-4 transition-colors",
        target.kind === "ready" && "cursor-pointer text-primary hover:underline",
        target.kind === "broken" && "cursor-default vh-error-text",
        target.kind === "pending" && "cursor-default text-muted-foreground/40",
      )}
    >
      <span className="truncate">{label}</span>
    </button>
  );
}

/** The empty-state "＋ Add link" ghost chip; opens the edit dialog. Shared by both variants. */
export function GhostChip({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex h-6 items-center gap-1.5 rounded-md border border-dashed border-border/70 px-2 text-[12px] text-muted-foreground/70 transition-colors hover:border-border hover:text-foreground"
    >
      <Plus size={11} className="flex-none" />
      <span>{m.add}</span>
    </button>
  );
}

/** The pencil affordance that opens the edit dialog. Shared by both variants. */
export function EditPencil({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={m.editAria}
      className="ml-0.5 inline-flex h-6 w-6 flex-none items-center justify-center rounded-md text-muted-foreground/55 transition-colors hover:bg-accent hover:text-foreground"
    >
      <Pencil size={12} />
    </button>
  );
}
