import { useMemo, useState } from "react";
import type { CollectionIpc } from "@/ipc/bindings";
import { allContainerIds, flattenVisible } from "./treeNav";

export interface PickTarget {
  collectionId: string;
  parentId: string | null; // null = collection root; otherwise a folder id
}

export interface CollectionPickerProps {
  collections: CollectionIpc[];
  query: string;
  value: PickTarget | null;
  onChange: (t: PickTarget) => void;
}

/** Case-insensitive substring filter that keeps a container if it OR any descendant matches. */
function filterTree(collections: CollectionIpc[], q: string): CollectionIpc[] {
  const needle = q.trim().toLowerCase();
  if (!needle) return collections;
  const keepItems = (items: CollectionIpc["items"]): CollectionIpc["items"] =>
    items
      .filter((it) => it.type === "folder")
      .map((it) => (it.type === "folder" ? { ...it, items: keepItems(it.items) } : it))
      .filter((it) => it.type === "folder" && (it.name.toLowerCase().includes(needle) || it.items.length > 0));
  return collections
    .map((c) => ({ ...c, items: keepItems(c.items) }))
    .filter((c) => c.name.toLowerCase().includes(needle) || c.items.length > 0);
}

export function CollectionPicker({ collections, query, value, onChange }: CollectionPickerProps) {
  const [open, setOpen] = useState<Set<string>>(new Set());

  const filtered = useMemo(() => filterTree(collections, query), [collections, query]);
  const filtering = query.trim().length > 0;
  const effectiveOpen = useMemo(
    () => (filtering ? new Set(allContainerIds(filtered)) : open),
    [filtering, filtered, open],
  );

  // Only containers (collections + folders) are selectable destinations.
  const visible = useMemo(
    () => flattenVisible(filtered, effectiveOpen).filter((n) => n.kind !== "request"),
    [filtered, effectiveOpen],
  );

  const toggle = (id: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const isSelected = (n: { kind: string; collectionId: string; id: string }) =>
    value != null &&
    value.collectionId === n.collectionId &&
    (n.kind === "collection" ? value.parentId === null : value.parentId === n.id);

  return (
    <div role="tree" aria-label="save-destination" className="min-h-0 flex-1 overflow-auto rounded-md border border-input p-1">
      {visible.map((n) => {
        const expandable = n.kind !== "request";
        const expanded = effectiveOpen.has(n.id);
        return (
          <div
            key={n.id}
            role="treeitem"
            data-selected={isSelected(n)}
            aria-selected={isSelected(n)}
            onClick={() => onChange({ collectionId: n.collectionId, parentId: n.kind === "collection" ? null : n.id })}
            style={{ paddingLeft: 6 + n.depth * 16 }}
            className={`flex cursor-pointer items-center gap-1 rounded px-1.5 py-1 text-sm hover:bg-accent ${
              isSelected(n) ? "bg-accent" : ""
            }`}
          >
            {expandable ? (
              <button
                type="button"
                aria-label={`expand ${n.name}`}
                onClick={(e) => {
                  e.stopPropagation();
                  toggle(n.id);
                }}
                className="w-4 text-muted-foreground"
              >
                {expanded ? "▾" : "▸"}
              </button>
            ) : (
              <span className="w-4" />
            )}
            <span>📁</span>
            <span className="truncate">{n.name}</span>
          </div>
        );
      })}
    </div>
  );
}
