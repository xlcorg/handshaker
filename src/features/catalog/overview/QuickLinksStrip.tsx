import { useState } from "react";
import { LinkChip, EditPencil, GhostChip } from "./LinkChip";
import { type LinkResolve, type LinkRow, renderableLinks } from "./linkTarget";
import { LinksEditDialog } from "./LinksEditDialog";
import type { VarCandidate } from "@/features/vars/candidates";

export interface QuickLinksStripProps extends LinkResolve {
  rows: LinkRow[];
  onChange: (nextRows: LinkRow[]) => void;
  /** Variable candidates for `{{`-autocomplete inside the edit dialog's URL field. */
  variables?: VarCandidate[];
}

/** Strip variant of the collection quick-links: a slim row of clickable chips shown on every
 *  collection tab, between the panel header and the tab bar. Editing lives behind the pencil
 *  (and the empty-state ghost chip), which opens the shared edit dialog. */
export function QuickLinksStrip({ rows, onChange, resolveUrl, resolveKey, variables }: QuickLinksStripProps) {
  const [editing, setEditing] = useState(false);
  const chips = renderableLinks(rows);

  return (
    <div className="flex-none flex items-center gap-1.5 border-b border-border/70 bg-card/20 px-4 py-1.5">
      {chips.length === 0 ? (
        <GhostChip onClick={() => setEditing(true)} />
      ) : (
        <>
          {chips.map((row) => (
            <LinkChip key={row.id} row={row} resolveUrl={resolveUrl} resolveKey={resolveKey} />
          ))}
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
