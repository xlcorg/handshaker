import type { CollectionIpc, ItemIpc } from "@/ipc/bindings";

export interface CollectionUsage {
  lastUsedAt: number | null; // max over descendant requests, null if none used
  useCount: number; // sum over descendant requests
}

function walk(items: ItemIpc[], acc: { last: number | null; count: number }): void {
  for (const it of items) {
    if (it.type === "folder") {
      walk(it.items, acc);
    } else {
      acc.count += it.use_count;
      if (it.last_used_at != null) {
        acc.last = acc.last == null ? it.last_used_at : Math.max(acc.last, it.last_used_at);
      }
    }
  }
}

/** Aggregate descendant-request usage for collection-level sorting. */
export function aggregateUsage(collection: CollectionIpc): CollectionUsage {
  const acc = { last: null as number | null, count: 0 };
  walk(collection.items, acc);
  return { lastUsedAt: acc.last, useCount: acc.count };
}

export type SortKey = "alpha" | "created" | "recent" | "frequency";

function byKey(a: CollectionIpc, b: CollectionIpc, key: SortKey): number {
  switch (key) {
    case "alpha":
      return a.name.localeCompare(b.name);
    case "created":
      return b.created_at - a.created_at || a.name.localeCompare(b.name); // newest first, name tie-break
    case "recent": {
      const al = aggregateUsage(a).lastUsedAt ?? -Infinity;
      const bl = aggregateUsage(b).lastUsedAt ?? -Infinity;
      return bl - al || a.name.localeCompare(b.name);
    }
    case "frequency": {
      const ac = aggregateUsage(a).useCount;
      const bc = aggregateUsage(b).useCount;
      return bc - ac || a.name.localeCompare(b.name);
    }
  }
}

/** Sort collections by the global key, pinned floated to the top. Pure (new array). */
export function sortCollections(collections: CollectionIpc[], key: SortKey): CollectionIpc[] {
  return [...collections].sort(
    (a, b) => Number(b.pinned) - Number(a.pinned) || byKey(a, b, key),
  );
}

function nameMatches(name: string, q: string): boolean {
  return name.toLowerCase().includes(q);
}

function requestMatches(it: Extract<ItemIpc, { type: "request" }>, q: string): boolean {
  return [it.name, it.service, it.method, it.address_template].some((s) =>
    s.toLowerCase().includes(q),
  );
}

function filterItems(items: ItemIpc[], q: string): ItemIpc[] {
  const out: ItemIpc[] = [];
  for (const it of items) {
    if (it.type === "request") {
      if (requestMatches(it, q)) out.push(it);
    } else if (nameMatches(it.name, q)) {
      out.push(it); // folder name matches -> keep whole subtree
    } else {
      const kids = filterItems(it.items, q);
      if (kids.length) out.push({ ...it, items: kids });
    }
  }
  return out;
}

/**
 * Prune the collection forest to nodes matching `query` (name/service/method/address).
 * Inputs are never mutated. Kept-whole nodes (empty query, name-matched collections/folders)
 * are returned by reference — consumers treat the result as read-only/immutable, matching
 * the store's immutable-update convention; this preserves React referential equality.
 */
export function filterCollections(collections: CollectionIpc[], query: string): CollectionIpc[] {
  const q = query.trim().toLowerCase();
  if (!q) return collections;
  const out: CollectionIpc[] = [];
  for (const c of collections) {
    if (nameMatches(c.name, q)) {
      out.push(c); // collection name matches -> keep whole
      continue;
    }
    const items = filterItems(c.items, q);
    if (items.length) out.push({ ...c, items });
  }
  return out;
}
