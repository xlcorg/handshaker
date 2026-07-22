import { useState } from "react";
import { ChevronDown } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { messages } from "@/lib/messages";
import { LinkChip, EditPencil, GhostChip } from "./LinkChip";
import { LinksEditDialog } from "./LinksEditDialog";
import { type LinkResolve, type LinkRow, renderableLinks } from "./linkTarget";
import type { VarCandidate } from "@/features/vars/candidates";

const m = messages.catalog.overview.links;

/** How many chips render inline in the header before the rest collapse into "+N".
 *  A fixed cap (not width-measured) keeps the title from being crowded out and the
 *  overflow behaviour deterministic to test. */
const HEADER_MAX_CHIPS = 3;

export interface HeaderLinksProps extends LinkResolve {
  rows: LinkRow[];
  onChange: (nextRows: LinkRow[]) => void;
  /** Variable candidates for `{{`-autocomplete inside the edit dialog's URL field. */
  variables?: VarCandidate[];
}

/** Header variant of the collection quick-links: chips inline in the panel header after the
 *  title/counters. Excess chips past {@link HEADER_MAX_CHIPS} collapse into a "+N" overflow
 *  menu with the same chip states/behaviour. Empty state and the pencil match the strip. */
export function HeaderLinks({ rows, onChange, resolveUrl, resolveKey, variables }: HeaderLinksProps) {
  const [editing, setEditing] = useState(false);

  const chips = renderableLinks(rows);
  const visible = chips.slice(0, HEADER_MAX_CHIPS);
  const overflow = chips.slice(HEADER_MAX_CHIPS);

  return (
    <div className="flex min-w-0 items-center gap-1.5">
      {chips.length === 0 ? (
        <GhostChip onClick={() => setEditing(true)} />
      ) : (
        <>
          {visible.map((row) => (
            <LinkChip key={row.id} row={row} resolveUrl={resolveUrl} resolveKey={resolveKey} />
          ))}
          {overflow.length > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  aria-label={m.overflowAria(overflow.length)}
                  className="inline-flex h-6 flex-none items-center gap-1 rounded-md border border-border/70 px-2 text-[12px] text-foreground/80 transition-colors hover:bg-accent hover:text-foreground"
                >
                  +{overflow.length}
                  <ChevronDown size={11} className="opacity-60" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="flex flex-col gap-1 p-1.5">
                {overflow.map((row) => (
                  <LinkChip key={row.id} row={row} resolveUrl={resolveUrl} resolveKey={resolveKey} />
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          <EditPencil onClick={() => setEditing(true)} />
        </>
      )}

      <LinksEditDialog
        open={editing}
        onOpenChange={setEditing}
        rows={rows}
        onChange={onChange}
        resolveUrl={resolveUrl}
        resolveKey={resolveKey}
        variables={variables}
      />
    </div>
  );
}
