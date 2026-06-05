import { useEffect, useRef, useState } from "react";
import { FolderPlus, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { readPrefs, usePrefs } from "@/lib/use-prefs";
import { newId } from "@/lib/ids";
import type { ItemIpc } from "@/ipc/bindings";
import { useCatalogTree } from "./useCatalogTree";
import { newRequestDraft, openSavedRequest } from "./actions";
import { filterCollections, sortCollections, type SortKey } from "./sort";
import { SortControl } from "./SortControl";
import { CollectionTree } from "./CollectionTree";

const MIN_WIDTH = 200;
const MAX_WIDTH = 600;

export interface SidebarShellProps {
  /** Open a collection's overview (CollectionOverview lands in plan-07). */
  onOpenCollection?: (collectionId: string) => void;
}

export function SidebarShell({ onOpenCollection }: SidebarShellProps) {
  const [prefs, setPref] = usePrefs();
  const cat = useCatalogTree();
  const [filter, setFilter] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("alpha");
  const [editingId, setEditingId] = useState<string | null>(null);
  const dragRef = useRef<{ startX: number; startW: number } | null>(null);

  // Ctrl/Cmd+B toggles sidebar visibility.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === "b" || e.key === "B")) {
        e.preventDefault();
        setPref("sidebar", !readPrefs().sidebar);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setPref]);

  if (!prefs.sidebar) return null;

  const filterActive = filter.trim().length > 0;
  const visible = sortCollections(filterCollections(cat.tree, filter), sortKey);

  const onAddFolder = (collectionId: string, parentId: string | null) => {
    const item: ItemIpc = { type: "folder", id: newId(), name: "New folder", items: [] };
    void cat.addItem(collectionId, parentId, item);
    setEditingId(item.id);
  };

  const onNewCollection = async () => {
    const id = await cat.createCollection("New collection");
    setEditingId(id);
  };

  const onResizePointerDown = (e: React.PointerEvent) => {
    dragRef.current = { startX: e.clientX, startW: prefs.sidebarWidth };
    const onMove = (ev: PointerEvent) => {
      if (!dragRef.current) return;
      const w = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, dragRef.current.startW + (ev.clientX - dragRef.current.startX)));
      setPref("sidebarWidth", w);
    };
    const onUp = () => {
      dragRef.current = null;
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  return (
    <div
      className="relative flex h-full flex-col border-r border-border bg-background"
      style={{ width: prefs.sidebarWidth }}
    >
      <div className="flex items-center gap-2 border-b border-border p-2">
        <Input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter collections…"
          className="h-8 text-xs"
          aria-label="collection-filter"
        />
        <Button size="icon" variant="ghost" aria-label="new-request" onClick={() => newRequestDraft()}>
          <Plus className="size-4" />
        </Button>
        <Button size="icon" variant="ghost" aria-label="new-collection" onClick={() => void onNewCollection()}>
          <FolderPlus className="size-4" />
        </Button>
      </div>

      <div className="flex items-center justify-between border-b border-border px-2 py-1">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          Collections
        </span>
        <SortControl value={sortKey} onChange={setSortKey} />
      </div>

      <CollectionTree
        collections={visible}
        filterActive={filterActive}
        activeItemId={null}
        editingId={editingId}
        onEditingChange={setEditingId}
        onOpenRequest={(collectionId, req) => openSavedRequest(collectionId, req)}
        onOpenCollection={onOpenCollection ?? (() => {})}
        onRenameItem={cat.renameItem}
        onRenameCollection={cat.renameCollection}
        onDuplicateItem={cat.duplicateItem}
        onDeleteItem={cat.deleteItem}
        onDeleteCollection={cat.deleteCollection}
        onAddRequest={() => newRequestDraft()}
        onAddFolder={onAddFolder}
        onSetPinned={cat.setPinned}
        onMoveItem={cat.moveItem}
        onMoveItemAcross={cat.moveItemAcross}
      />

      {cat.error ? (
        <div className="border-t border-destructive bg-destructive/5 px-2 py-1 text-[11px] text-destructive">
          {cat.error}
        </div>
      ) : null}

      {/* Resize handle */}
      <div
        role="separator"
        aria-label="resize-sidebar"
        aria-orientation="vertical"
        onPointerDown={onResizePointerDown}
        className="absolute right-0 top-0 h-full w-1 cursor-col-resize hover:bg-accent"
      />
    </div>
  );
}
