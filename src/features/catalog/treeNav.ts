import type { CollectionIpc, ItemIpc, SavedRequestIpc } from "@/ipc/bindings";

/** Count request leaves under a collection, folder, or item. */
export function countRequests(node: CollectionIpc | ItemIpc): number {
  if ("type" in node && node.type === "request") return 1;
  const items: ItemIpc[] = "items" in node ? node.items : [];
  return items.reduce((n, it) => n + countRequests(it), 0);
}

/** Every collection id + folder id (containers), excluding request leaves. */
export function allContainerIds(collections: CollectionIpc[]): string[] {
  const out: string[] = [];
  const walk = (items: ItemIpc[]) => {
    for (const it of items) {
      if (it.type === "folder") {
        out.push(it.id);
        walk(it.items);
      }
    }
  };
  for (const c of collections) {
    out.push(c.id);
    walk(c.items);
  }
  return out;
}

function findAncestors(items: ItemIpc[], itemId: string, acc: string[]): string[] | null {
  for (const it of items) {
    if (it.id === itemId) return acc;
    if (it.type === "folder") {
      const r = findAncestors(it.items, itemId, [...acc, it.id]);
      if (r) return r;
    }
  }
  return null;
}

/** Ordered container ids `[collectionId, ...folderIds]` to reach `itemId`, or null. */
export function pathToItem(collections: CollectionIpc[], itemId: string | null): string[] | null {
  if (!itemId) return null;
  for (const c of collections) {
    if (c.id === itemId) return [c.id];
    const sub = findAncestors(c.items, itemId, []);
    if (sub) return [c.id, ...sub];
  }
  return null;
}

function findNamePath(items: ItemIpc[], itemId: string, acc: string[]): string[] | null {
  for (const it of items) {
    if (it.id === itemId) return [...acc, it.name];
    if (it.type === "folder") {
      const r = findNamePath(it.items, itemId, [...acc, it.name]);
      if (r) return r;
    }
  }
  return null;
}

/** Ordered display names `[collectionName, ...folderNames, itemName]` to reach `itemId`
 *  (the path INCLUDES the target item's own name), or null when not found. */
export function pathNamesToItem(
  collections: CollectionIpc[],
  itemId: string | null,
): string[] | null {
  if (!itemId) return null;
  for (const c of collections) {
    if (c.id === itemId) return [c.name];
    const sub = findNamePath(c.items, itemId, [c.name]);
    if (sub) return sub;
  }
  return null;
}

export type VisibleNode =
  | { kind: "collection"; collectionId: string; id: string; name: string; depth: number }
  | { kind: "folder"; collectionId: string; id: string; name: string; depth: number }
  | { kind: "request"; collectionId: string; id: string; req: SavedRequestIpc; depth: number };

function pushItems(
  items: ItemIpc[],
  collectionId: string,
  depth: number,
  open: Set<string>,
  out: VisibleNode[],
): void {
  for (const it of items) {
    if (it.type === "folder") {
      out.push({ kind: "folder", collectionId, id: it.id, name: it.name, depth });
      if (open.has(it.id)) pushItems(it.items, collectionId, depth + 1, open, out);
    } else {
      out.push({ kind: "request", collectionId, id: it.id, req: it, depth });
    }
  }
}

/** Pre-order list of currently-visible nodes (collections + expanded descendants). */
export function flattenVisible(collections: CollectionIpc[], open: Set<string>): VisibleNode[] {
  const out: VisibleNode[] = [];
  for (const c of collections) {
    out.push({ kind: "collection", collectionId: c.id, id: c.id, name: c.name, depth: 0 });
    if (open.has(c.id)) pushItems(c.items, c.id, 1, open, out);
  }
  return out;
}
