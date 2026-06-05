import type { CollectionIpc, ItemIpc } from "@/ipc/bindings";

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

export function removeCollectionFromTree(
  tree: CollectionIpc[],
  collectionId: string,
): CollectionIpc[] {
  return tree.filter((c) => c.id !== collectionId);
}
