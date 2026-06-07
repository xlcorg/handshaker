import type { CollectionIpc, ItemIpc, SavedRequestIpc } from "@/ipc/bindings";

function mapCollection(
  tree: CollectionIpc[],
  collectionId: string,
  fn: (c: CollectionIpc) => CollectionIpc,
): CollectionIpc[] {
  return tree.map((c) => (c.id === collectionId ? fn(c) : c));
}

function mapItemsDeep(items: ItemIpc[], itemId: string, fn: (it: ItemIpc) => ItemIpc): ItemIpc[] {
  return items.map((it) => {
    if (it.id === itemId) return fn(it);
    if (it.type === "folder") return { ...it, items: mapItemsDeep(it.items, itemId, fn) };
    return it;
  });
}

function removeItemsDeep(items: ItemIpc[], itemId: string): ItemIpc[] {
  const out: ItemIpc[] = [];
  for (const it of items) {
    if (it.id === itemId) continue;
    if (it.type === "folder") out.push({ ...it, items: removeItemsDeep(it.items, itemId) });
    else out.push(it);
  }
  return out;
}

function insertItemsDeep(items: ItemIpc[], parentId: string | null, item: ItemIpc): ItemIpc[] {
  if (parentId === null) return [...items, item];
  return items.map((it) => {
    if (it.type !== "folder") return it;
    if (it.id === parentId) return { ...it, items: [...it.items, item] };
    return { ...it, items: insertItemsDeep(it.items, parentId, item) };
  });
}

export function renameItemInTree(
  tree: CollectionIpc[],
  collectionId: string,
  itemId: string,
  name: string,
): CollectionIpc[] {
  return mapCollection(tree, collectionId, (c) => ({
    ...c,
    items: mapItemsDeep(c.items, itemId, (it) => ({ ...it, name })),
  }));
}

export function removeItemFromTree(
  tree: CollectionIpc[],
  collectionId: string,
  itemId: string,
): CollectionIpc[] {
  return mapCollection(tree, collectionId, (c) => ({ ...c, items: removeItemsDeep(c.items, itemId) }));
}

export function insertItemInTree(
  tree: CollectionIpc[],
  collectionId: string,
  parentId: string | null,
  item: ItemIpc,
): CollectionIpc[] {
  return mapCollection(tree, collectionId, (c) => ({
    ...c,
    items: insertItemsDeep(c.items, parentId, item),
  }));
}

export function renameCollectionInTree(
  tree: CollectionIpc[],
  collectionId: string,
  name: string,
): CollectionIpc[] {
  return mapCollection(tree, collectionId, (c) => ({ ...c, name }));
}

export function setCollectionPinned(
  tree: CollectionIpc[],
  collectionId: string,
  pinned: boolean,
): CollectionIpc[] {
  return mapCollection(tree, collectionId, (c) => ({ ...c, pinned }));
}

/** Set a container's expanded flag: `itemId === null` targets the collection, else a folder. */
export function setNodeExpanded(
  tree: CollectionIpc[],
  collectionId: string,
  itemId: string | null,
  expanded: boolean,
): CollectionIpc[] {
  if (itemId === null) {
    return mapCollection(tree, collectionId, (c) => ({ ...c, expanded }));
  }
  return mapCollection(tree, collectionId, (c) => ({
    ...c,
    items: mapItemsDeep(c.items, itemId, (it) =>
      it.type === "folder" ? { ...it, expanded } : it,
    ),
  }));
}

/** Swap a saved request's content fields in place, preserving id/name/usage/type. */
export function replaceItemInTree(
  tree: CollectionIpc[],
  collectionId: string,
  itemId: string,
  content: SavedRequestIpc,
): CollectionIpc[] {
  return mapCollection(tree, collectionId, (c) => ({
    ...c,
    items: mapItemsDeep(c.items, itemId, (it) => {
      if (it.type !== "request") return it;
      return {
        ...it,
        address_template: content.address_template,
        service: content.service,
        method: content.method,
        body_template: content.body_template,
        metadata: content.metadata,
        auth: content.auth,
        tls_override: content.tls_override,
      };
    }),
  }));
}

export function removeCollectionFromTree(
  tree: CollectionIpc[],
  collectionId: string,
): CollectionIpc[] {
  return tree.filter((c) => c.id !== collectionId);
}

function detachDeep(items: ItemIpc[], itemId: string): { items: ItemIpc[]; removed: ItemIpc | null } {
  let removed: ItemIpc | null = null;
  const out: ItemIpc[] = [];
  for (const it of items) {
    if (it.id === itemId) {
      removed = it;
      continue;
    }
    if (it.type === "folder") {
      const r = detachDeep(it.items, itemId);
      if (r.removed) removed = r.removed;
      out.push({ ...it, items: r.items });
    } else {
      out.push(it);
    }
  }
  return { items: out, removed };
}

function insertAtDeep(
  items: ItemIpc[],
  parentId: string | null,
  position: number,
  item: ItemIpc,
): ItemIpc[] {
  if (parentId === null) {
    const next = [...items];
    next.splice(Math.max(0, Math.min(position, next.length)), 0, item);
    return next;
  }
  return items.map((it) => {
    if (it.type !== "folder") return it;
    if (it.id === parentId) {
      const next = [...it.items];
      next.splice(Math.max(0, Math.min(position, next.length)), 0, item);
      return { ...it, items: next };
    }
    return { ...it, items: insertAtDeep(it.items, parentId, position, item) };
  });
}

/** Move an item within one collection: remove it, then insert at `parentId`/`position`. */
export function moveItemWithinTree(
  tree: CollectionIpc[],
  collectionId: string,
  itemId: string,
  parentId: string | null,
  position: number,
): CollectionIpc[] {
  return tree.map((c) => {
    if (c.id !== collectionId) return c;
    const det = detachDeep(c.items, itemId);
    if (!det.removed) return c;
    return { ...c, items: insertAtDeep(det.items, parentId, position, det.removed) };
  });
}

/** Move an item from one collection to another: detach from source, insert into target. */
export function moveItemAcrossTree(
  tree: CollectionIpc[],
  sourceCollectionId: string,
  itemId: string,
  targetCollectionId: string,
  parentId: string | null,
  position: number,
): CollectionIpc[] {
  let moved: ItemIpc | null = null;
  const afterDetach = tree.map((c) => {
    if (c.id !== sourceCollectionId) return c;
    const det = detachDeep(c.items, itemId);
    moved = det.removed;
    return { ...c, items: det.items };
  });
  if (!moved) return tree;
  return afterDetach.map((c) =>
    c.id === targetCollectionId
      ? { ...c, items: insertAtDeep(c.items, parentId, position, moved as ItemIpc) }
      : c,
  );
}
