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
