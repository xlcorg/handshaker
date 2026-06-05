import { ChevronRight, FilePlus, Folder, FolderPlus, Pencil, Trash2 } from "lucide-react";
import { cn } from "@/lib/cn";
import type { ItemIpc } from "@/ipc/bindings";
import { RowMenu, type RowMenuItem } from "./RowMenu";
import { RenameInput } from "./RenameInput";
import { RequestRow, ROW_INDENT, DEPTH_STEP } from "./RequestRow";
import { zoneFromPointer } from "./dnd";
import type { TreeCallbacks } from "./treeTypes";

type FolderItem = Extract<ItemIpc, { type: "folder" }>;

export interface FolderNodeProps {
  collectionId: string;
  folder: FolderItem;
  depth: number;
  cb: TreeCallbacks;
}

export function FolderNode({ collectionId, folder, depth, cb }: FolderNodeProps) {
  const open = cb.open.has(folder.id);
  const editing = cb.editingId === folder.id;
  const focused = cb.focusedId === folder.id;
  const hint = cb.dropHint?.id === folder.id ? cb.dropHint.zone : null;

  const items: RowMenuItem[] = [
    { icon: <FilePlus />, label: "Add request", onClick: () => cb.onAddRequest(collectionId, folder.id) },
    { icon: <FolderPlus />, label: "Add folder", onClick: () => cb.onAddFolder(collectionId, folder.id) },
    { icon: <Pencil />, label: "Rename", onClick: () => cb.onEditingChange(folder.id) },
    { sep: true },
    { icon: <Trash2 />, label: "Delete", danger: true, onClick: () => cb.onRequestDeleteItem(collectionId, folder.id) },
  ];

  return (
    <div>
      <RowMenu items={items}>
        <div
          data-node-id={folder.id}
          data-drop={hint ?? undefined}
          draggable={!editing}
          onDragStart={(e) => {
            if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
            cb.onDragStartItem({ collectionId, itemId: folder.id, kind: "folder" });
          }}
          onDragOver={(e) => {
            e.preventDefault();
            const r = e.currentTarget.getBoundingClientRect();
            cb.onDragOverRow({ collectionId, id: folder.id, kind: "folder" }, zoneFromPointer(r, e.clientY, "folder"));
          }}
          onDrop={(e) => {
            e.preventDefault();
            const r = e.currentTarget.getBoundingClientRect();
            cb.onDropRow({ collectionId, id: folder.id, kind: "folder" }, zoneFromPointer(r, e.clientY, "folder"));
          }}
          onDragEnd={cb.onDragEndItem}
          className={cn(
            "group relative flex items-center gap-1 py-1 pr-8 text-xs hover:bg-accent/50",
            focused && "ring-1 ring-inset ring-ring",
            cb.dragId === folder.id && "opacity-50",
            hint === "inside" && "ring-1 ring-inset ring-primary bg-primary/5",
            hint === "before" && "shadow-[inset_0_2px_0_0_hsl(var(--primary))]",
            hint === "after" && "shadow-[inset_0_-2px_0_0_hsl(var(--primary))]",
          )}
          style={{ paddingLeft: ROW_INDENT + depth * DEPTH_STEP }}
        >
          {editing ? (
            <>
              <ChevronRight className={cn("size-3 flex-none transition-transform", open && "rotate-90")} />
              <Folder className="size-3.5 flex-none text-muted-foreground" />
              <RenameInput
                initial={folder.name}
                onCommit={(name) => {
                  cb.onEditingChange(null);
                  cb.onRenameItem(collectionId, folder.id, name);
                }}
                onCancel={() => cb.onEditingChange(null)}
              />
            </>
          ) : (
            <button
              type="button"
              aria-label="toggle-folder"
              onClick={() => cb.onToggle(folder.id)}
              onDoubleClick={() => cb.onEditingChange(folder.id)}
              className="flex min-w-0 flex-1 items-center gap-1 text-left"
            >
              <ChevronRight className={cn("size-3 flex-none transition-transform", open && "rotate-90")} />
              <Folder className="size-3.5 flex-none text-muted-foreground" />
              <span className="truncate">{folder.name}</span>
            </button>
          )}
        </div>
      </RowMenu>

      {open ? (
        <div>
          {folder.items.map((it) =>
            it.type === "folder" ? (
              <FolderNode key={it.id} collectionId={collectionId} folder={it} depth={depth + 1} cb={cb} />
            ) : (
              <RequestRow key={it.id} collectionId={collectionId} req={it} depth={depth + 1} cb={cb} />
            ),
          )}
        </div>
      ) : null}
    </div>
  );
}
