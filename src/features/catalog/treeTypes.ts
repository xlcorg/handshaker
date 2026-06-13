import type { SavedRequestIpc } from "@/ipc/bindings";
import type { DragData, DropTarget, DropZone } from "./dnd";

/** Callback + view-state bag threaded through CollectionNode/FolderNode/RequestRow. */
export interface TreeCallbacks {
  open: Set<string>;
  activeItemId: string | null;
  /** id of the collection whose overview is the active main panel ("in focus"), or null. */
  activeCollectionId: string | null;
  focusedId: string | null;
  editingId: string | null;
  onToggle: (id: string) => void;
  onEditingChange: (id: string | null) => void;
  onOpenRequest: (collectionId: string, req: SavedRequestIpc) => void;
  onOpenCollection: (collectionId: string) => void;
  onRenameItem: (collectionId: string, itemId: string, name: string) => void;
  onRenameCollection: (collectionId: string, name: string) => void;
  onDuplicateItem: (collectionId: string, itemId: string) => void;
  /** Request deletion of an item (CollectionTree opens the confirm dialog). */
  onRequestDeleteItem: (collectionId: string, itemId: string) => void;
  /** Request deletion of a collection (CollectionTree opens the confirm dialog). */
  onRequestDeleteCollection: (collectionId: string) => void;
  onAddRequest: (collectionId: string, parentId: string | null) => void;
  onAddFolder: (collectionId: string, parentId: string | null) => void;
  onSetPinned: (collectionId: string, pinned: boolean) => void;
  /** id of the row currently being dragged (for styling), or null. */
  dragId: string | null;
  /** the row currently under the cursor + its resolved drop zone, or null. */
  dropHint: { id: string; zone: DropZone } | null;
  onDragStartItem: (drag: DragData) => void;
  onDragOverRow: (target: DropTarget, zone: DropZone) => void;
  onDropRow: (target: DropTarget, zone: DropZone) => void;
  onDragEndItem: () => void;
}
