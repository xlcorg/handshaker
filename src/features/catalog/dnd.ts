import type { CollectionIpc, ItemIpc } from "@/ipc/bindings";

export type DragKind = "folder" | "request";
export type DropZone = "before" | "after" | "inside";
export type TargetKind = "collection" | "folder" | "request";

export interface DragData {
  collectionId: string;
  itemId: string;
  kind: DragKind;
}

export interface DropTarget {
  collectionId: string;
  /** Collection id when kind === "collection", otherwise the item id. */
  id: string;
  kind: TargetKind;
}

export interface MovePlan {
  sourceCollectionId: string;
  itemId: string;
  targetCollectionId: string;
  /** Destination container: a folder id, or null for the collection root. */
  parentId: string | null;
  /** Insert index in the destination container AFTER the dragged item is removed. */
  position: number;
}

type FolderItem = Extract<ItemIpc, { type: "folder" }>;

/** Number of folders in a container (folders are kept in the leading block). */
export function folderCount(items: ItemIpc[]): number {
  return items.filter((it) => it.type === "folder").length;
}

function findFolder(items: ItemIpc[], id: string): FolderItem | null {
  for (const it of items) {
    if (it.type === "folder") {
      if (it.id === id) return it;
      const r = findFolder(it.items, id);
      if (r) return r;
    }
  }
  return null;
}

function containsId(items: ItemIpc[], id: string): boolean {
  for (const it of items) {
    if (it.id === id) return true;
    if (it.type === "folder" && containsId(it.items, id)) return true;
  }
  return false;
}

/** True if `candidateId` is `folderId` itself or lives anywhere inside it. */
export function isWithin(items: ItemIpc[], folderId: string, candidateId: string): boolean {
  if (folderId === candidateId) return true;
  const f = findFolder(items, folderId);
  return f ? containsId(f.items, candidateId) : false;
}

interface Loc {
  container: ItemIpc[];
  index: number;
  parentId: string | null;
}

function locate(items: ItemIpc[], id: string, parentId: string | null): Loc | null {
  const idx = items.findIndex((it) => it.id === id);
  if (idx >= 0) return { container: items, index: idx, parentId };
  for (const it of items) {
    if (it.type === "folder") {
      const r = locate(it.items, id, it.id);
      if (r) return r;
    }
  }
  return null;
}

function containerItems(col: CollectionIpc, parentId: string | null): ItemIpc[] | null {
  if (parentId === null) return col.items;
  const f = findFolder(col.items, parentId);
  return f ? f.items : null;
}

/** Derive the drop mode from the pointer's vertical position within a target row. */
export function zoneFromPointer(
  rect: { top: number; height: number },
  clientY: number,
  targetKind: TargetKind,
): DropZone {
  if (targetKind === "collection") return "inside";
  const rel = rect.height > 0 ? (clientY - rect.top) / rect.height : 0;
  if (targetKind === "folder") {
    if (rel < 0.33) return "before";
    if (rel > 0.66) return "after";
    return "inside";
  }
  return rel < 0.5 ? "before" : "after";
}

/**
 * Resolve a drag gesture into a concrete move, or `null` when the drop is invalid or a no-op.
 * Enforces folders-on-top and rejects dropping a folder inside itself/a descendant.
 */
export function planDrop(
  tree: CollectionIpc[],
  drag: DragData,
  target: DropTarget,
  zone: DropZone,
): MovePlan | null {
  const srcCol = tree.find((c) => c.id === drag.collectionId);
  const tgtCol = tree.find((c) => c.id === target.collectionId);
  if (!srcCol || !tgtCol) return null;

  const from = locate(srcCol.items, drag.itemId, null);
  if (!from) return null;

  let parentId: string | null;
  let destItems: ItemIpc[];
  let anchorIndex: number | null = null;

  if (zone === "inside") {
    if (target.kind === "request") return null; // can't nest into a request
    parentId = target.kind === "collection" ? null : target.id;
    const dest = containerItems(tgtCol, parentId);
    if (!dest) return null;
    destItems = dest;
  } else {
    if (target.kind === "collection") return null; // before/after needs an item sibling
    const t = locate(tgtCol.items, target.id, null);
    if (!t) return null;
    parentId = t.parentId;
    destItems = t.container;
    anchorIndex = t.index + (zone === "after" ? 1 : 0);
  }

  // Folder cannot land inside itself or one of its descendants (same collection only).
  if (drag.collectionId === target.collectionId && drag.kind === "folder") {
    if (parentId !== null && isWithin(srcCol.items, drag.itemId, parentId)) return null;
  }

  // Post-removal view of the destination container (only shifts when the dragged item shares it).
  const sameContainer = drag.collectionId === target.collectionId && from.parentId === parentId;
  const effItems = sameContainer ? destItems.filter((it) => it.id !== drag.itemId) : destItems;

  let raw: number;
  if (zone === "inside") {
    raw = drag.kind === "folder" ? folderCount(effItems) : effItems.length;
  } else {
    raw = anchorIndex as number;
    if (sameContainer && from.index < (anchorIndex as number)) raw -= 1; // removal shifts left
  }

  const fc = folderCount(effItems);
  const position =
    drag.kind === "folder"
      ? Math.max(0, Math.min(raw, fc))
      : Math.max(fc, Math.min(raw, effItems.length));

  if (sameContainer && position === from.index) return null; // no-op

  return {
    sourceCollectionId: drag.collectionId,
    itemId: drag.itemId,
    targetCollectionId: target.collectionId,
    parentId,
    position,
  };
}
