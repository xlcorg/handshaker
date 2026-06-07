import { ChevronRight, FilePlus, Folder, FolderPlus, Pencil, Trash2 } from "lucide-react";
import { cn } from "@/lib/cn";
import type { ItemIpc } from "@/ipc/bindings";
import { SidebarMenuSub, SidebarMenuSubButton, SidebarMenuSubItem } from "@/components/ui/sidebar";
import { RowMenu, type RowMenuItem } from "./RowMenu";
import { RenameInput } from "./RenameInput";
import { RequestRow } from "./RequestRow";
import { bleedStyle } from "./bleed";
import { zoneFromPointer } from "./dnd";
import type { TreeCallbacks } from "./treeTypes";

type FolderItem = Extract<ItemIpc, { type: "folder" }>;

export interface FolderNodeProps {
  collectionId: string;
  folder: FolderItem;
  /** Nesting level of this folder (1 = direct child of a collection). */
  depth?: number;
  cb: TreeCallbacks;
}

export function FolderNode({ collectionId, folder, depth = 1, cb }: FolderNodeProps) {
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
    <SidebarMenuSubItem>
      <RowMenu items={items} depth={depth}>
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
          // Full-bleed hover highlight, same mechanism as RequestRow (see bleed.ts). The
          // ::before breaks out of the nested SidebarMenuSub inset to span the full width.
          style={bleedStyle(depth)}
          className={cn(
            "group relative isolate flex items-center gap-1 pr-8 text-xs",
            "before:pointer-events-none before:absolute before:inset-y-0 before:left-[var(--bl)] before:right-[var(--br)] before:-z-10 before:rounded-md before:content-['']",
            "hover:before:bg-sidebar-accent/50",
            focused && "ring-1 ring-inset ring-ring",
            cb.dragId === folder.id && "opacity-50",
            hint === "inside" && "ring-1 ring-inset ring-primary bg-primary/5",
            hint === "before" && "shadow-[inset_0_2px_0_0_hsl(var(--primary))]",
            hint === "after" && "shadow-[inset_0_-2px_0_0_hsl(var(--primary))]",
          )}
        >
          <button
            type="button"
            aria-label="toggle-folder"
            onClick={() => cb.onToggle(folder.id)}
            className="flex-none"
          >
            <ChevronRight className={cn("size-3 transition-transform", open && "rotate-90")} />
          </button>
          {editing ? (
            <>
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
            <SidebarMenuSubButton asChild size="sm">
              <button
                type="button"
                aria-label="expand-folder"
                onClick={() => cb.onToggle(folder.id)}
                onDoubleClick={() => cb.onEditingChange(folder.id)}
                // Defer the highlight to the row's full-bleed ::before. `px-0` strips the
                // SidebarMenuSubButton's inherent px-2 so the folder icon/label sit tight.
                className="flex h-6! min-w-0 flex-1 items-center gap-0.5! bg-transparent! px-0! text-left hover:bg-transparent! active:bg-transparent!"
              >
                <Folder className="size-3.5 flex-none text-muted-foreground" />
                <span className="truncate">{folder.name}</span>
              </button>
            </SidebarMenuSubButton>
          )}
        </div>
      </RowMenu>

      {open ? (
        <SidebarMenuSub className="mx-2 gap-0.5 px-2 py-0 border-transparent hover:border-sidebar-border">
          {folder.items.map((it) =>
            it.type === "folder" ? (
              <FolderNode key={it.id} collectionId={collectionId} folder={it} depth={depth + 1} cb={cb} />
            ) : (
              <RequestRow key={it.id} collectionId={collectionId} req={it} depth={depth + 1} cb={cb} />
            ),
          )}
        </SidebarMenuSub>
      ) : null}
    </SidebarMenuSubItem>
  );
}
