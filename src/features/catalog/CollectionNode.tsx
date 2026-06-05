import { ChevronRight, FilePlus, FolderPlus, Pencil, Trash2 } from "lucide-react";
import { cn } from "@/lib/cn";
import type { CollectionIpc } from "@/ipc/bindings";
import { RowMenu, type RowMenuItem } from "./RowMenu";
import { RenameInput } from "./RenameInput";
import { PinButton } from "./PinButton";
import { FolderNode } from "./FolderNode";
import { RequestRow } from "./RequestRow";
import type { TreeCallbacks } from "./treeTypes";

export interface CollectionNodeProps {
  col: CollectionIpc;
  cb: TreeCallbacks;
}

export function CollectionNode({ col, cb }: CollectionNodeProps) {
  const open = cb.open.has(col.id);
  const editing = cb.editingId === col.id;
  const focused = cb.focusedId === col.id;

  const items: RowMenuItem[] = [
    { icon: <FilePlus />, label: "Add request", onClick: () => cb.onAddRequest(col.id, null) },
    { icon: <FolderPlus />, label: "Add folder", onClick: () => cb.onAddFolder(col.id, null) },
    { icon: <Pencil />, label: "Rename", onClick: () => cb.onEditingChange(col.id) },
    { sep: true },
    { icon: <Trash2 />, label: "Delete", danger: true, onClick: () => cb.onRequestDeleteCollection(col.id) },
  ];

  return (
    <div>
      <RowMenu items={items}>
        <div
          data-node-id={col.id}
          className={cn(
            "group flex items-center gap-1 py-1 pr-8 pl-1.5 text-xs font-medium hover:bg-accent/50",
            focused && "ring-1 ring-inset ring-ring",
          )}
        >
          <button
            type="button"
            aria-label="toggle-collection"
            onClick={() => cb.onToggle(col.id)}
            className="flex-none"
          >
            <ChevronRight className={cn("size-3 transition-transform", open && "rotate-90")} />
          </button>
          {editing ? (
            <RenameInput
              initial={col.name}
              onCommit={(name) => {
                cb.onEditingChange(null);
                cb.onRenameCollection(col.id, name);
              }}
              onCancel={() => cb.onEditingChange(null)}
            />
          ) : (
            <button
              type="button"
              aria-label="open-collection"
              onClick={() => cb.onOpenCollection(col.id)}
              onDoubleClick={() => cb.onEditingChange(col.id)}
              className="min-w-0 flex-1 truncate text-left"
            >
              {col.name}
            </button>
          )}
          <PinButton pinned={col.pinned} onToggle={() => cb.onSetPinned(col.id, !col.pinned)} />
        </div>
      </RowMenu>

      {open ? (
        <div>
          {col.items.map((it) =>
            it.type === "folder" ? (
              <FolderNode key={it.id} collectionId={col.id} folder={it} depth={1} cb={cb} />
            ) : (
              <RequestRow key={it.id} collectionId={col.id} req={it} depth={1} cb={cb} />
            ),
          )}
          {col.items.length === 0 ? (
            <div className="py-1 pl-8 text-[11px] text-muted-foreground">Empty collection</div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
