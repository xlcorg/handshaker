import { ChevronRight, Folder, Pencil, Trash2, FilePlus, FolderPlus } from "lucide-react";
import { cn } from "@/lib/cn";
import type { ItemIpc, SavedRequestIpc } from "@/ipc/bindings";

type FolderItem = Extract<ItemIpc, { type: "folder" }>;
import { countRequests } from "./treeUtils";
import { RowMenu, type RowMenuItem } from "./RowMenu";
import { RequestRow, RenameInput } from "./RequestRow";
import { useState } from "react";

export interface FolderNodeProps {
  collectionId: string;
  folder: FolderItem;
  depth: number;
  open: Set<string>;
  onToggle: (id: string) => void;
  activeItemId: string | null;
  onSelectRequest: (collectionId: string, req: SavedRequestIpc) => void;
  onRenameItem: (collectionId: string, itemId: string, name: string) => void;
  onDeleteItem: (collectionId: string, itemId: string) => void;
}

export function FolderNode({
  collectionId,
  folder,
  depth,
  open,
  onToggle,
  activeItemId,
  onSelectRequest,
  onRenameItem,
  onDeleteItem,
}: FolderNodeProps) {
  const [editing, setEditing] = useState(false);
  const count = countRequests(folder);
  // Empty folders are hidden.
  if (count === 0) return null;

  const isOpen = open.has(folder.id);
  // Chevron gutter (20px) + 14px per level.
  const padLeft = 20 + depth * 14;

  const items: RowMenuItem[] = [
    {
      icon: <FilePlus />,
      label: "New request",
      onClick: () => console.debug("[collections] new request in folder (stub)", folder.id),
    },
    {
      icon: <FolderPlus />,
      label: "New folder",
      onClick: () => console.debug("[collections] new folder in folder (stub)", folder.id),
    },
    { icon: <Pencil />, label: "Rename", onClick: () => setEditing(true) },
    { sep: true },
    {
      icon: <Trash2 />,
      label: "Delete",
      danger: true,
      onClick: () => onDeleteItem(collectionId, folder.id),
    },
  ];

  return (
    <div>
      <RowMenu items={items} className="rounded-md" padRight={4}>
        {editing ? (
          <div
            className="relative flex !h-[22px] items-center gap-1.5"
            style={{ paddingLeft: padLeft - 20 + 4, paddingRight: 8 }}
          >
            <span className="flex h-4 w-4 flex-none items-center justify-center text-muted-foreground">
              <ChevronRight className="size-2.5" />
            </span>
            <Folder className="size-3 flex-none text-muted-foreground" />
            <RenameInput
              initial={folder.name}
              onCommit={(name) => {
                setEditing(false);
                const trimmed = name.trim();
                if (trimmed && trimmed !== folder.name)
                  onRenameItem(collectionId, folder.id, trimmed);
              }}
              onCancel={() => setEditing(false)}
            />
          </div>
        ) : (
          <button
            type="button"
            onClick={() => onToggle(folder.id)}
            style={{ paddingLeft: padLeft - 20 + 4 }}
            className={cn(
              "flex !h-[22px] w-full items-center gap-1.5 rounded-md pr-7 !text-[11.5px] text-muted-foreground",
              "hover:bg-accent/60 hover:text-foreground transition-colors",
            )}
          >
            <span
              className={cn(
                "flex h-4 w-4 flex-none items-center justify-center transition-transform",
                isOpen && "rotate-90",
              )}
            >
              <ChevronRight className="size-2.5" />
            </span>
            <Folder className="size-3 flex-none" />
            <span className="min-w-0 flex-1 truncate text-left">{folder.name}</span>
            <span className="font-mono text-[10px] tabular-nums text-muted-foreground/70">
              {count}
            </span>
          </button>
        )}
      </RowMenu>

      {isOpen &&
        folder.items.map((child) =>
          child.type === "folder" ? (
            <FolderNode
              key={child.id}
              collectionId={collectionId}
              folder={child}
              depth={depth + 1}
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
              collectionId={collectionId}
              req={child}
              depth={depth + 1}
              activeItemId={activeItemId}
              onSelectRequest={onSelectRequest}
              onRenameItem={onRenameItem}
              onDeleteItem={onDeleteItem}
            />
          ),
        )}
    </div>
  );
}
