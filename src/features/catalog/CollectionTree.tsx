import { useEffect, useMemo, useState, type KeyboardEvent } from "react";
import type { CollectionIpc, SavedRequestIpc } from "@/ipc/bindings";
import { CollectionNode } from "./CollectionNode";
import { ConfirmDeleteDialog } from "./ConfirmDeleteDialog";
import { allContainerIds, flattenVisible, pathToItem } from "./treeNav";
import type { TreeCallbacks } from "./treeTypes";

export interface CollectionTreeProps {
  collections: CollectionIpc[]; // already sorted + filtered by SidebarShell
  filterActive: boolean;
  activeItemId: string | null;
  editingId: string | null;
  onEditingChange: (id: string | null) => void;
  onOpenRequest: (collectionId: string, req: SavedRequestIpc) => void;
  onOpenCollection: (collectionId: string) => void;
  onRenameItem: (collectionId: string, itemId: string, name: string) => void;
  onRenameCollection: (collectionId: string, name: string) => void;
  onDuplicateItem: (collectionId: string, itemId: string) => void;
  onDeleteItem: (collectionId: string, itemId: string) => void;
  onDeleteCollection: (collectionId: string) => void;
  onAddRequest: (collectionId: string, parentId: string | null) => void;
  onAddFolder: (collectionId: string, parentId: string | null) => void;
  onSetPinned: (collectionId: string, pinned: boolean) => void;
}

type DeleteTarget =
  | { kind: "item"; collectionId: string; itemId: string }
  | { kind: "collection"; collectionId: string };

export function CollectionTree(props: CollectionTreeProps) {
  const { collections, filterActive, editingId } = props;
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [delTarget, setDelTarget] = useState<DeleteTarget | null>(null);

  // While filtering, treat everything as expanded.
  const effectiveOpen = useMemo(
    () => (filterActive ? new Set(allContainerIds(collections)) : open),
    [filterActive, collections, open],
  );

  // Reveal the editing node by opening its ancestor containers.
  useEffect(() => {
    if (!editingId) return;
    const path = pathToItem(collections, editingId);
    if (path) setOpen((prev) => new Set([...prev, ...path]));
  }, [editingId, collections]);

  const visible = useMemo(() => flattenVisible(collections, effectiveOpen), [collections, effectiveOpen]);

  // Drop keyboard focus if the focused node is no longer visible (collapsed/filtered out).
  useEffect(() => {
    if (focusedId && !visible.some((n) => n.id === focusedId)) setFocusedId(null);
  }, [visible, focusedId]);

  const setOpenId = (id: string, want: boolean) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (want) next.add(id);
      else next.delete(id);
      return next;
    });

  const toggle = (id: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (editingId) return; // rename input owns the keyboard
    const idx = visible.findIndex((n) => n.id === focusedId);
    const cur = idx >= 0 ? visible[idx] : null;
    switch (e.key) {
      case "ArrowDown": {
        e.preventDefault();
        const n = visible[Math.min(idx + 1, visible.length - 1)] ?? visible[0];
        if (n) setFocusedId(n.id);
        break;
      }
      case "ArrowUp": {
        e.preventDefault();
        const n = visible[Math.max(idx - 1, 0)] ?? visible[0];
        if (n) setFocusedId(n.id);
        break;
      }
      case "ArrowRight":
        e.preventDefault();
        if (cur && cur.kind !== "request") setOpenId(cur.id, true);
        break;
      case "ArrowLeft":
        e.preventDefault();
        if (cur && cur.kind !== "request") setOpenId(cur.id, false);
        break;
      case "Enter":
        e.preventDefault();
        if (!cur) break;
        if (cur.kind === "request") props.onOpenRequest(cur.collectionId, cur.req);
        else if (cur.kind === "collection") props.onOpenCollection(cur.collectionId);
        else toggle(cur.id);
        break;
      case "F2":
        e.preventDefault();
        if (cur) props.onEditingChange(cur.id);
        break;
    }
  };

  const cb: TreeCallbacks = {
    open: effectiveOpen,
    activeItemId: props.activeItemId,
    focusedId,
    editingId,
    onToggle: toggle,
    onEditingChange: props.onEditingChange,
    onOpenRequest: props.onOpenRequest,
    onOpenCollection: props.onOpenCollection,
    onRenameItem: props.onRenameItem,
    onRenameCollection: props.onRenameCollection,
    onDuplicateItem: props.onDuplicateItem,
    onRequestDeleteItem: (collectionId, itemId) => setDelTarget({ kind: "item", collectionId, itemId }),
    onRequestDeleteCollection: (collectionId) => setDelTarget({ kind: "collection", collectionId }),
    onAddRequest: props.onAddRequest,
    onAddFolder: props.onAddFolder,
    onSetPinned: props.onSetPinned,
  };

  const confirmDelete = () => {
    if (!delTarget) return;
    if (delTarget.kind === "item") props.onDeleteItem(delTarget.collectionId, delTarget.itemId);
    else props.onDeleteCollection(delTarget.collectionId);
  };

  return (
    <div
      role="tree"
      tabIndex={0}
      aria-label="collections-tree"
      onKeyDown={onKeyDown}
      className="min-h-0 flex-1 overflow-auto py-1 outline-none"
    >
      {collections.map((c) => (
        <CollectionNode key={c.id} col={c} cb={cb} />
      ))}

      <ConfirmDeleteDialog
        open={delTarget !== null}
        title={delTarget?.kind === "collection" ? "Delete collection?" : "Delete request?"}
        description="This cannot be undone."
        onConfirm={confirmDelete}
        onOpenChange={(o) => {
          if (!o) setDelTarget(null);
        }}
      />
    </div>
  );
}
