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
      return b.created_at - a.created_at; // newest first
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
