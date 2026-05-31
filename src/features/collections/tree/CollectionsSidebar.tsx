import { useState } from "react";
import {
  Filter,
  Plus,
  MoreHorizontal,
  FolderPlus,
  Crosshair,
  ChevronsDownUp,
  ChevronsUpDown,
  Download,
  Upload,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import type { CollectionIpc, SavedRequestIpc } from "@/ipc/bindings";
import { allContainerIds, filterNode, pathToSelected } from "./treeUtils";
import { CollectionNode } from "./CollectionNode";

export interface CollectionsSidebarProps {
  tree: CollectionIpc[];
  activeItemId: string | null;
  onSelectRequest: (collectionId: string, req: SavedRequestIpc) => void;
  onOpenCollection: (collectionId: string) => void;
  onNewRequest: () => void;
  onNewCollection: () => void;
  onDeleteItem: (collectionId: string, itemId: string) => void;
  onRenameItem: (collectionId: string, itemId: string, name: string) => void;
  onDeleteCollection: (collectionId: string) => void;
}

export function CollectionsSidebar({
  tree,
  activeItemId,
  onSelectRequest,
  onOpenCollection,
  onNewRequest,
  onNewCollection,
  onDeleteItem,
  onRenameItem,
  onDeleteCollection,
}: CollectionsSidebarProps) {
  const [query, setQuery] = useState("");
  // Containers expanded by default: auto-open the path to the active request.
  const [open, setOpen] = useState<Set<string>>(() => {
    const path = pathToSelected(tree, activeItemId);
    return new Set(path ?? []);
  });

  const toggle = (id: string) => {
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const allIds = (): string[] => {
    const ids: string[] = [];
    for (const col of tree) {
      ids.push(col.id);
      allContainerIds(col.items, ids);
    }
    return ids;
  };

  const expandAll = () => setOpen(new Set(allIds()));
  const collapseAll = () => setOpen(new Set());
  const revealActive = () => {
    const path = pathToSelected(tree, activeItemId);
    if (path) setOpen((prev) => new Set([...prev, ...path]));
  };

  const filtering = query.trim().length > 0;
  const filtered: CollectionIpc[] = filtering
    ? tree
        .map((col) => filterNode(col, query))
        .filter((c): c is CollectionIpc => c !== null)
    : tree;

  // When filtering, everything is treated as expanded.
  const effectiveOpen = filtering ? new Set(allIds()) : open;

  return (
    <aside className="w-[300px] flex-none border-r border-border bg-background flex flex-col min-h-0">
      <div className="flex-none flex items-center gap-1.5 px-2.5 py-2 border-b border-border">
        <div className="relative min-w-0 flex-1">
          <span className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground">
            <Filter className="size-3" />
          </span>
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter collections & requests"
            className="h-8 pl-7 pr-2 text-xs"
          />
        </div>
        <Tooltip content="New request">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="h-8 w-8 flex-none"
            onClick={onNewRequest}
            aria-label="New request"
          >
            <Plus className="size-4" />
          </Button>
        </Tooltip>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="h-8 w-8 flex-none"
              aria-label="Collection actions"
            >
              <MoreHorizontal className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-[200px]">
            <DropdownMenuItem onClick={onNewCollection}>
              <FolderPlus />
              New collection
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={revealActive}>
              <Crosshair />
              Reveal active request
            </DropdownMenuItem>
            <DropdownMenuItem onClick={expandAll}>
              <ChevronsUpDown />
              Expand all
            </DropdownMenuItem>
            <DropdownMenuItem onClick={collapseAll}>
              <ChevronsDownUp />
              Collapse all
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => console.debug("[collections] import (stub)")}
            >
              <Download />
              Import collection…
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => console.debug("[collections] export (stub)")}
            >
              <Upload />
              Export collection…
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="flex-1 overflow-auto scroll-thin px-1.5 pt-1.5 pb-3">
        {tree.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 px-4 py-10 text-center">
            <div className="text-xs text-muted-foreground">No collections yet</div>
            <div className="flex items-center gap-1.5">
              <Button type="button" variant="outline" size="sm" onClick={onNewCollection}>
                <FolderPlus className="size-3.5" />
                New collection
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => console.debug("[collections] import (stub)")}
              >
                <Download className="size-3.5" />
                Import
              </Button>
            </div>
          </div>
        ) : filtering && filtered.length === 0 ? (
          <div className="px-3 py-8 text-center text-xs text-muted-foreground">
            Nothing matches &ldquo;{query.trim()}&rdquo;
          </div>
        ) : (
          filtered.map((col) => (
            <CollectionNode
              key={col.id}
              col={col}
              open={effectiveOpen}
              onToggle={toggle}
              activeItemId={activeItemId}
              onSelectRequest={onSelectRequest}
              onOpenCollection={onOpenCollection}
              onRenameItem={onRenameItem}
              onDeleteItem={onDeleteItem}
              onDeleteCollection={onDeleteCollection}
            />
          ))
        )}
      </div>
    </aside>
  );
}
