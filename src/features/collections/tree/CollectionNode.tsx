import { useState } from "react";
import {
  ChevronRight,
  Plus,
  Pencil,
  Copy,
  Trash2,
  FilePlus,
  FolderPlus,
  PanelsTopLeft,
  Upload,
} from "lucide-react";
import { cn } from "@/lib/cn";
import type { CollectionIpc, SavedRequestIpc } from "@/ipc/bindings";
import { countRequests } from "./treeUtils";
import { RowMenu, type RowMenuItem } from "./RowMenu";
import { RenameInput } from "./RequestRow";
import { FolderNode } from "./FolderNode";
import { RequestRow } from "./RequestRow";

export interface CollectionNodeProps {
  col: CollectionIpc;
  open: Set<string>;
  onToggle: (id: string) => void;
  activeItemId: string | null;
  onSelectRequest: (collectionId: string, req: SavedRequestIpc) => void;
  onOpenCollection: (collectionId: string) => void;
  onRenameItem: (collectionId: string, itemId: string, name: string) => void;
  onDeleteItem: (collectionId: string, itemId: string) => void;
  onDeleteCollection: (collectionId: string) => void;
}

export function CollectionNode({
  col,
  open,
  onToggle,
  activeItemId,
  onSelectRequest,
  onOpenCollection,
  onRenameItem,
  onDeleteItem,
  onDeleteCollection,
}: CollectionNodeProps) {
  const [editing, setEditing] = useState(false);
  const isOpen = open.has(col.id);
  const count = countRequests(col);

  const items: RowMenuItem[] = [
    {
      icon: <PanelsTopLeft />,
      label: "Open overview",
      onClick: () => onOpenCollection(col.id),
    },
    { sep: true },
    {
      icon: <FilePlus />,
      label: "New request",
      onClick: () => console.debug("[collections] new request (stub)", col.id),
    },
    {
      icon: <FolderPlus />,
      label: "New folder",
      onClick: () => console.debug("[collections] new folder (stub)", col.id),
    },
    { icon: <Pencil />, label: "Rename", onClick: () => setEditing(true) },
    {
      icon: <Copy />,
      label: "Duplicate",
      onClick: () => console.debug("[collections] duplicate collection (stub)", col.id),
    },
    { sep: true },
    {
      icon: <Upload />,
      label: "Export…",
      onClick: () => console.debug("[collections] export (stub)", col.id),
    },
    { sep: true },
    {
      icon: <Trash2 />,
      label: "Delete",
      danger: true,
      onClick: () => onDeleteCollection(col.id),
    },
  ];

  return (
    <div className="mb-0.5">
      <RowMenu items={items} className="rounded-md" padRight={4}>
        {editing ? (
          <div className="relative flex !h-[24px] items-center gap-1.5 pl-1 pr-2">
            <span className="flex h-4 w-4 flex-none items-center justify-center text-muted-foreground">
              <ChevronRight className="size-2.5" />
            </span>
            <RenameInput
              initial={col.name}
              onCommit={(name) => {
                setEditing(false);
                const trimmed = name.trim();
                if (trimmed && trimmed !== col.name) onRenameItem(col.id, col.id, trimmed);
              }}
              onCancel={() => setEditing(false)}
            />
          </div>
        ) : (
          <div className="relative flex !h-[24px] items-center rounded-md pr-7 hover:bg-accent/50">
            <button
              type="button"
              onClick={() => onToggle(col.id)}
              aria-label={isOpen ? "Collapse" : "Expand"}
              className="absolute left-0 flex h-[24px] w-5 items-center justify-center text-muted-foreground"
            >
              <ChevronRight
                className={cn("size-2.5 transition-transform", isOpen && "rotate-90")}
              />
            </button>
            <button
              type="button"
              onClick={() => onOpenCollection(col.id)}
              className="flex h-[24px] min-w-0 flex-1 items-center gap-1.5 pl-5 !text-[12px] text-foreground/80 hover:text-foreground"
            >
              <span className="min-w-0 flex-1 truncate text-left">{col.name}</span>
            </button>
            <span className="ml-1.5 font-mono text-[10px] tabular-nums text-muted-foreground/70">
              {count}
            </span>
          </div>
        )}
      </RowMenu>

      {isOpen &&
        (col.items.length === 0 ? (
          <button
            type="button"
            onClick={() => console.debug("[collections] add first request (stub)", col.id)}
            className="flex !h-[22px] w-full items-center gap-1 rounded-md pl-5 pr-2 !text-[11.5px] text-muted-foreground/70 hover:bg-accent/40 hover:text-foreground"
          >
            <span>No requests yet</span>
            <span className="text-muted-foreground/50">·</span>
            <Plus className="size-3" />
            <span>Add</span>
          </button>
        ) : (
          col.items.map((child) =>
            child.type === "folder" ? (
              <FolderNode
                key={child.id}
                collectionId={col.id}
                folder={child}
                depth={0}
                open={open}
                onToggle={onToggle}
                activeItemId={activeItemId}
                onSelectRequest={onSelectRequest}
                onRenameItem={onRenameItem}
                onDeleteItem={onDeleteItem}
              />
            ) : (
              <RequestRow
                key={child.id}
                collectionId={col.id}
                req={child}
                depth={0}
                activeItemId={activeItemId}
                onSelectRequest={onSelectRequest}
                onRenameItem={onRenameItem}
                onDeleteItem={onDeleteItem}
              />
            ),
          )
        ))}
    </div>
  );
}
