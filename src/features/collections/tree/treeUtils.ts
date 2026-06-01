import type { CollectionIpc, ItemIpc } from "@/ipc/bindings";

/**
 * Count all request leaves recursively inside a node.
 * Accepts either an `ItemIpc` (folder or request) or a `CollectionIpc`.
 */
export function countRequests(node: ItemIpc | CollectionIpc): number {
  // CollectionIpc has no `type` field; narrow via "type" in node
  if ("type" in node) {
    // ItemIpc branch
    if (node.type === "request") return 1;
    // folder
    return node.items.reduce((sum, child) => sum + countRequests(child), 0);
  }
  // CollectionIpc branch
  return node.items.reduce((sum, child) => sum + countRequests(child), 0);
}

/**
 * Collect ids of all folder nodes (containers) within an item list, recursively.
 */
export function allContainerIds(items: ItemIpc[], acc: string[] = []): string[] {
  for (const item of items) {
    if (item.type === "folder") {
      acc.push(item.id);
      allContainerIds(item.items, acc);
    }
  }
  return acc;
}

/**
 * Returns the ordered list of container ids (collection id first, then folder ids)
 * on the path from root to the request whose `id === itemId`.
 * Returns `null` if the request is not found anywhere.
 */
export function pathToSelected(
  collections: CollectionIpc[],
  itemId: string | null,
): string[] | null {
  if (itemId === null) return null;

  function searchItems(items: ItemIpc[], path: string[]): string[] | null {
    for (const item of items) {
      if (item.type === "request") {
        if (item.id === itemId) return path;
      } else {
        // folder
        const found = searchItems(item.items, [...path, item.id]);
        if (found !== null) return found;
      }
    }
    return null;
  }

  for (const col of collections) {
    const found = searchItems(col.items, [col.id]);
    if (found !== null) return found;
  }
  return null;
}

/**
 * Filter a node, keeping only request leaves that match `q` (case-insensitive),
 * matched on `name`, `service`, `method`, or `address_template`.
 * Folders with no matching descendants are pruned.
 * If a CollectionIpc's own name matches, all its children are kept.
 *
 * Returns a structurally-cloned (shallow-on-non-items-fields) node with filtered
 * `items`, or `null` if nothing survives the filter.
 */
export function filterNode<T extends CollectionIpc | ItemIpc>(node: T, q: string): T | null {
  const lq = q.trim().toLowerCase();
  if (!lq) return node;

  // CollectionIpc — no `type` field
  if (!("type" in node)) {
    const col = node as CollectionIpc;
    // If collection name matches, keep all children
    if (col.name.toLowerCase().includes(lq)) {
      return { ...col } as T;
    }
    const filteredItems = col.items
      .map((child) => filterNode(child, q))
      .filter((c): c is ItemIpc => c !== null);
    if (filteredItems.length === 0) return null;
    return { ...col, items: filteredItems } as T;
  }

  // ItemIpc branch
  const item = node as ItemIpc;

  if (item.type === "request") {
    const matches =
      item.name.toLowerCase().includes(lq) ||
      item.service.toLowerCase().includes(lq) ||
      item.method.toLowerCase().includes(lq) ||
      item.address_template.toLowerCase().includes(lq);
    return matches ? ({ ...item } as T) : null;
  }

  // folder
  // If folder name matches, keep all children
  if (item.name.toLowerCase().includes(lq)) {
    return { ...item } as T;
  }
  const filteredItems = item.items
    .map((child) => filterNode(child, q))
    .filter((c): c is ItemIpc => c !== null);
  if (filteredItems.length === 0) return null;
  return { ...item, items: filteredItems } as T;
}
