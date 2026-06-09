import { Copy, Pencil, Trash2 } from "lucide-react";
import { cn } from "@/lib/cn";
import type { SavedRequestIpc } from "@/ipc/bindings";
import {
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from "@/components/ui/sidebar";
import { RowMenu, type RowMenuItem } from "./RowMenu";
import { RenameInput } from "./RenameInput";
import { DropSlot } from "./DropSlot";
import { zoneFromPointer } from "./dnd";
import type { TreeCallbacks } from "./treeTypes";
import { GrpcIcon } from "./GrpcIcon";
import { bleedStyle } from "./bleed";
import { usePrefs } from "@/lib/use-prefs";

export interface RequestRowProps {
  collectionId: string;
  req: SavedRequestIpc;
  /** Nesting level (1 = direct child of a collection). Drives the full-bleed highlight. */
  depth?: number;
  cb: TreeCallbacks;
}

export function RequestRow({
  collectionId,
  req,
  depth = 1,
  cb,
}: RequestRowProps) {
  const [{ grpcIcon }] = usePrefs();
  const editing = cb.editingId === req.id;
  const active = cb.activeItemId === req.id;
  const focused = cb.focusedId === req.id;
  const hint = cb.dropHint?.id === req.id ? cb.dropHint.zone : null;

  const items: RowMenuItem[] = [
    {
      icon: <Pencil />,
      label: "Rename",
      onClick: () => cb.onEditingChange(req.id),
    },
    {
      icon: <Copy />,
      label: "Duplicate",
      onClick: () => cb.onDuplicateItem(collectionId, req.id),
    },
    { sep: true },
    {
      icon: <Trash2 />,
      label: "Delete",
      danger: true,
      onClick: () => cb.onRequestDeleteItem(collectionId, req.id),
    },
  ];

  const dndHandlers = {
    draggable: !editing,
    onDragStart: (e: React.DragEvent<HTMLDivElement>) => {
      if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
      cb.onDragStartItem({ collectionId, itemId: req.id, kind: "request" });
    },
    onDragOver: (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      const r = e.currentTarget.getBoundingClientRect();
      cb.onDragOverRow(
        { collectionId, id: req.id, kind: "request" },
        zoneFromPointer(r, e.clientY, "request"),
      );
    },
    onDrop: (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      const r = e.currentTarget.getBoundingClientRect();
      cb.onDropRow(
        { collectionId, id: req.id, kind: "request" },
        zoneFromPointer(r, e.clientY, "request"),
      );
    },
    onDragEnd: cb.onDragEndItem,
  };

  return (
    <>
      {hint === "before" && <DropSlot depth={depth} />}
      <SidebarMenuSubItem>
        <RowMenu items={items} depth={depth}>
          {editing ? (
            <div
              data-node-id={req.id}
              className="group relative flex items-center gap-0.5 py-1 pr-8 text-xs"
            >
              <GrpcIcon variant={grpcIcon} className="flex-none" />
              <RenameInput
                initial={req.name}
                onCommit={(name) => {
                  cb.onEditingChange(null);
                  cb.onRenameItem(collectionId, req.id, name);
                }}
                onCancel={() => cb.onEditingChange(null)}
              />
            </div>
          ) : (
            <SidebarMenuSubButton asChild isActive={active} size="sm">
              <div
                data-node-id={req.id}
                data-drop={hint ?? undefined}
                {...dndHandlers}
                onClick={() => cb.onOpenRequest(collectionId, req)}
                onDoubleClick={() => cb.onEditingChange(req.id)}
                // Full-bleed highlight: a request lives inside `depth` nested
                // <SidebarMenuSub> wrappers (see bleed.ts). We paint the hover/active
                // background on a ::before that breaks out of that inset back to the sidebar
                // edges, so the row highlights full-width Postman-style while the label stays
                // indented. `overflow-visible!` lets the ::before escape the button's clip;
                // `bg-transparent!` defers the bg to the ::before.
                style={bleedStyle(depth)}
                className={cn(
                  "group relative isolate flex h-6! w-full items-center gap-0.5! overflow-visible! bg-transparent! pr-8",
                  "before:pointer-events-none before:absolute before:inset-y-0 before:left-[var(--bl)] before:right-[var(--br)] before:-z-10 before:rounded-md before:content-['']",
                  "hover:before:bg-sidebar-accent/50",
                  // Active (open) request: full-bleed accent + a left marker pinned to the
                  // sidebar edge, so it's clearly distinct from a mere hover.
                  active &&
                    "font-medium before:bg-sidebar-accent after:pointer-events-none after:absolute after:inset-y-0 after:left-[var(--bl)] after:w-[2px] after:rounded-full after:bg-primary",
                  focused && "ring-1 ring-inset ring-ring",
                  cb.dragId === req.id && "opacity-50",
                )}
              >
                <GrpcIcon variant={grpcIcon} className="flex-none" />
                <span className="min-w-0 flex-1 truncate text-left">
                  {req.name || req.method}
                </span>
              </div>
            </SidebarMenuSubButton>
          )}
        </RowMenu>
      </SidebarMenuSubItem>
      {hint === "after" && <DropSlot depth={depth} />}
    </>
  );
}
