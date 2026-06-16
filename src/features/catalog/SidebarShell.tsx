import { useEffect, useState } from "react";
import { Download, FilePlus, FolderPlus, MoreHorizontal, Plus, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Sidebar, SidebarHeader, SidebarContent, SidebarGroupLabel } from "@/components/ui/sidebar";
import { newId } from "@/lib/ids";
import type { ItemIpc, SavedRequestIpc } from "@/ipc/bindings";
import { useCatalog } from "./CatalogProvider";
import { newRequestDraft, openSavedRequest } from "./actions";
import { filterCollections, sortCollections, type SortKey } from "./sort";
import { SortControl } from "./SortControl";
import { CollectionTree } from "./CollectionTree";
import { exportBundle } from "./transfer";
import { useImportFlow } from "./useImportFlow";
import { ImportSummaryDialog } from "./ImportSummaryDialog";
import { loadUiState, patchUiState } from "./uiState";

export interface SidebarShellProps {
  /** Open a collection's overview (CollectionOverview lands in plan-07). */
  onOpenCollection?: (collectionId: string) => void;
  /** Open a saved request (default: direct `openSavedRequest`). Lets a parent guard the open. */
  onOpenRequest?: (collectionId: string, req: SavedRequestIpc) => void;
  /** Start a new request draft (default: direct `newRequestDraft`). Lets a parent guard it. */
  onAddRequest?: () => void;
  /** Id of the currently-open saved request, highlighted in the tree. */
  activeItemId?: string | null;
  /** Id of the collection whose overview is the active main panel ("in focus"), or null. */
  activeCollectionId?: string | null;
}

export function SidebarShell({
  onOpenCollection,
  onOpenRequest,
  onAddRequest,
  activeItemId = null,
  activeCollectionId = null,
}: SidebarShellProps) {
  const openRequest = onOpenRequest ?? openSavedRequest;
  const addRequest = onAddRequest ?? newRequestDraft;
  const cat = useCatalog();
  const importFlow = useImportFlow();
  const [filter, setFilter] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("alpha");
  const [editingId, setEditingId] = useState<string | null>(null);

  // Restore the persisted sort key once on mount (via the shared uiState cache).
  useEffect(() => {
    void loadUiState().then((s) => {
      if (s.sort_key) setSortKey(s.sort_key as SortKey);
    });
  }, []);

  const onChangeSort = (k: SortKey) => {
    setSortKey(k);
    void patchUiState({ sort_key: k });
  };

  const filterActive = filter.trim().length > 0;
  const visible = sortCollections(filterCollections(cat.tree, filter), sortKey);

  const onAddFolder = (collectionId: string, parentId: string | null) => {
    const item: ItemIpc = { type: "folder", id: newId(), name: "New folder", items: [], expanded: false };
    void cat.addItem(collectionId, parentId, item);
    setEditingId(item.id);
  };

  const onNewCollection = async () => {
    const id = await cat.createCollection("New collection");
    setEditingId(id);
  };

  return (
    <Sidebar collapsible="none" style={{ "--sidebar-width": "100%" } as React.CSSProperties} className="h-full">
      <SidebarHeader className="gap-0 p-0">
        <div className="flex items-center gap-1 border-b border-border p-1.5">
          <Input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter collections…"
            className="h-7 text-xs"
            aria-label="collection-filter"
          />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="icon-sm" variant="ghost" aria-label="new-item" className="size-7">
                <Plus className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem aria-label="new-request" onClick={() => addRequest()}>
                <FilePlus />
                New request
              </DropdownMenuItem>
              <DropdownMenuItem aria-label="new-collection" onClick={() => void onNewCollection()}>
                <FolderPlus />
                New collection
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <div className="flex items-center justify-between border-b border-border px-2 py-1">
          <SidebarGroupLabel className="h-auto text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Collections</SidebarGroupLabel>
          <div className="flex items-center gap-1">
            <SortControl value={sortKey} onChange={onChangeSort} />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="icon-sm" variant="ghost" aria-label="collection actions" className="size-6">
                  <MoreHorizontal className="size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem aria-label="export" onClick={() => void exportBundle(null, "handshaker-export.json")}>
                  <Download />
                  Export
                </DropdownMenuItem>
                <DropdownMenuItem aria-label="import" onClick={() => void importFlow.start()}>
                  <Upload />
                  Import
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </SidebarHeader>

      <SidebarContent className="min-h-0 overflow-hidden">
        <CollectionTree
          collections={visible}
          filterActive={filterActive}
          activeItemId={activeItemId ?? null}
          activeCollectionId={activeCollectionId ?? null}
          editingId={editingId}
          onEditingChange={setEditingId}
          onOpenRequest={(collectionId, req) => openRequest(collectionId, req)}
          onOpenCollection={onOpenCollection ?? (() => {})}
          onRenameItem={cat.renameItem}
          onRenameCollection={cat.renameCollection}
          onDuplicateItem={cat.duplicateItem}
          onDeleteItem={cat.deleteItem}
          onDeleteCollection={cat.deleteCollection}
          onExportCollection={(id) => {
            const c = cat.tree.find((x) => x.id === id);
            void exportBundle(id, `${c?.name ?? "collection"}.json`);
          }}
          onAddRequest={() => addRequest()}
          onAddFolder={onAddFolder}
          onSetPinned={cat.setPinned}
          onMoveItem={cat.moveItem}
          onMoveItemAcross={cat.moveItemAcross}
          onSetExpanded={cat.setExpanded}
        />
      </SidebarContent>
      <ImportSummaryDialog
        open={importFlow.pending !== null}
        summary={importFlow.pending?.summary ?? null}
        onConfirm={() => void importFlow.confirm()}
        onCancel={importFlow.cancel}
      />
    </Sidebar>
  );
}
