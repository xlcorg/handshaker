import { ChevronRight, FilePlus, FolderPlus, Pencil, Trash2 } from "lucide-react";
import { cn } from "@/lib/cn";
import type { CollectionIpc } from "@/ipc/bindings";
import { SidebarMenuItem, SidebarMenuButton, SidebarMenuSub } from "@/components/ui/sidebar";
import { RowMenu, type RowMenuItem } from "./RowMenu";
import { RenameInput } from "./RenameInput";
import { PinButton } from "./PinButton";
import { FolderNode } from "./FolderNode";
import { RequestRow } from "./RequestRow";
import { bleedStyle } from "./bleed";
import type { TreeCallbacks } from "./treeTypes";

export interface CollectionNodeProps {
  col: CollectionIpc;
  cb: TreeCallbacks;
}

export function CollectionNode({ col, cb }: CollectionNodeProps) {
  const open = cb.open.has(col.id);
  const editing = cb.editingId === col.id;
  const focused = cb.focusedId === col.id;
  const hint = cb.dropHint?.id === col.id ? cb.dropHint.zone : null;

  const items: RowMenuItem[] = [
    { icon: <FilePlus />, label: "Add request", onClick: () => cb.onAddRequest(col.id, null) },
    { icon: <FolderPlus />, label: "Add folder", onClick: () => cb.onAddFolder(col.id, null) },
    { icon: <Pencil />, label: "Rename", onClick: () => cb.onEditingChange(col.id) },
    { sep: true },
    { icon: <Trash2 />, label: "Delete", danger: true, onClick: () => cb.onRequestDeleteCollection(col.id) },
  ];

  return (
    <SidebarMenuItem>
      <RowMenu items={items}>
        <div
          data-node-id={col.id}
          data-drop={hint ?? undefined}
          onDragOver={(e) => {
            e.preventDefault();
            cb.onDragOverRow({ collectionId: col.id, id: col.id, kind: "collection" }, "inside");
          }}
          onDrop={(e) => {
            e.preventDefault();
            cb.onDropRow({ collectionId: col.id, id: col.id, kind: "collection" }, "inside");
          }}
          // Full-bleed hover highlight, same mechanism as the rows below (see bleed.ts).
          style={bleedStyle(0)}
          className={cn(
            "group relative isolate flex items-center gap-1 pr-8 pl-1.5 text-xs font-medium",
            "before:pointer-events-none before:absolute before:inset-y-0 before:left-[var(--bl)] before:right-[var(--br)] before:-z-10 before:rounded-md before:content-['']",
            "hover:before:bg-sidebar-accent/50",
            focused && "ring-1 ring-inset ring-ring",
            hint === "inside" && "bg-primary/10",
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
            <SidebarMenuButton asChild size="sm">
              <button
                type="button"
                aria-label="open-collection"
                onClick={() => {
                  cb.onOpenCollection(col.id);
                  cb.onToggle(col.id);
                }}
                onDoubleClick={() => cb.onEditingChange(col.id)}
                // Defer the highlight to the row's full-bleed ::before. `px-0` strips the
                // SidebarMenuButton's inherent p-2 so the label sits tight to the chevron
                // (the row's own gap-1 is the only spacing).
                className="h-6! min-w-0 flex-1 truncate bg-transparent! px-0! text-left hover:bg-transparent! active:bg-transparent!"
              >
                <span className="truncate">{col.name}</span>
              </button>
            </SidebarMenuButton>
          )}
          <PinButton pinned={col.pinned} onToggle={() => cb.onSetPinned(col.id, !col.pinned)} />
        </div>
      </RowMenu>

      {open ? (
        <SidebarMenuSub
          className={cn(
            "mx-2 gap-0.5 px-2 py-0 border-transparent hover:border-sidebar-border",
            hint === "inside" && "rounded-md bg-primary/5",
          )}
        >
          {col.items.map((it) =>
            it.type === "folder" ? (
              <FolderNode key={it.id} collectionId={col.id} folder={it} depth={1} cb={cb} />
            ) : (
              <RequestRow key={it.id} collectionId={col.id} req={it} depth={1} cb={cb} />
            ),
          )}
          {col.items.length === 0 ? (
            <li className="py-1 pl-2 text-[11px] text-muted-foreground">Empty collection</li>
          ) : null}
        </SidebarMenuSub>
      ) : null}
    </SidebarMenuItem>
  );
}
