import { Copy, Pencil, Trash2 } from "lucide-react";
import { cn } from "@/lib/cn";
import type { SavedRequestIpc } from "@/ipc/bindings";
import { RowMenu, type RowMenuItem } from "./RowMenu";
import { RenameInput } from "./RenameInput";
import type { TreeCallbacks } from "./treeTypes";

export const ROW_INDENT = 20;
export const DEPTH_STEP = 14;

export interface RequestRowProps {
  collectionId: string;
  req: SavedRequestIpc;
  depth: number;
  cb: TreeCallbacks;
}

/** Monochrome stream-type badge. SavedRequest carries no rpc stream type yet, so this
 *  is a placeholder (`un`) until the resolved contract is wired (spec §5, later phase). */
function StreamBadge() {
  return (
    <span
      aria-label="stream-type"
      className="flex-none rounded border border-border px-1 text-[9px] font-mono uppercase text-muted-foreground"
    >
      un
    </span>
  );
}

export function RequestRow({ collectionId, req, depth, cb }: RequestRowProps) {
  const editing = cb.editingId === req.id;
  const active = cb.activeItemId === req.id;
  const focused = cb.focusedId === req.id;

  const items: RowMenuItem[] = [
    { icon: <Pencil />, label: "Rename", onClick: () => cb.onEditingChange(req.id) },
    { icon: <Copy />, label: "Duplicate", onClick: () => cb.onDuplicateItem(collectionId, req.id) },
    { sep: true },
    { icon: <Trash2 />, label: "Delete", danger: true, onClick: () => cb.onRequestDeleteItem(collectionId, req.id) },
  ];

  return (
    <RowMenu items={items}>
      <div
        data-node-id={req.id}
        className={cn(
          "group flex items-center gap-2 py-1 pr-8 text-xs hover:bg-accent/50",
          active && "bg-accent",
          focused && "ring-1 ring-inset ring-ring",
        )}
        style={{ paddingLeft: ROW_INDENT + depth * DEPTH_STEP }}
      >
        <StreamBadge />
        {editing ? (
          <RenameInput
            initial={req.name}
            onCommit={(name) => {
              cb.onEditingChange(null);
              cb.onRenameItem(collectionId, req.id, name);
            }}
            onCancel={() => cb.onEditingChange(null)}
          />
        ) : (
          <button
            type="button"
            aria-label="open-request"
            onDoubleClick={() => cb.onEditingChange(req.id)}
            onClick={() => cb.onOpenRequest(collectionId, req)}
            className="min-w-0 flex-1 truncate text-left"
          >
            {req.name || req.method}
          </button>
        )}
      </div>
    </RowMenu>
  );
}
