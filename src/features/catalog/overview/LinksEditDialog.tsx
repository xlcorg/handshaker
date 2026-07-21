import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { messages } from "@/lib/messages";
import { LinksBlock } from "./LinksBlock";
import type { LinkResolve, LinkRow } from "./linkTarget";
import type { VarCandidate } from "@/features/vars/candidates";

const m = messages.catalog.overview.links;

export interface LinksEditDialogProps extends LinkResolve {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  rows: LinkRow[];
  onChange: (nextRows: LinkRow[]) => void;
  /** Variable candidates for `{{`-autocomplete inside the URL field. */
  variables?: VarCandidate[];
}

/** Edit surface for collection links (Edit Environment pattern): the name+URL rows grid,
 *  add and delete. Edits persist through the whole-collection upsert via `onChange` — the
 *  same seam the grid used inline. Presentation-only move; no new persistence path. */
export function LinksEditDialog({
  open,
  onOpenChange,
  rows,
  onChange,
  resolveUrl,
  resolveKey,
  variables,
}: LinksEditDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] w-full max-w-[min(90vw,720px)] flex-col sm:max-w-[min(90vw,720px)]">
        <DialogHeader>
          <DialogTitle>{m.dialogTitle}</DialogTitle>
          <DialogDescription>{m.dialogDesc}</DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-auto">
          <LinksBlock
            rows={rows}
            onChange={onChange}
            resolveUrl={resolveUrl}
            resolveKey={resolveKey}
            variables={variables}
          />
        </div>

        <DialogFooter>
          <Button onClick={() => onOpenChange(false)}>{m.done}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
