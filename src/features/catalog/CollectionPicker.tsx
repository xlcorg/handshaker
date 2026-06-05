import { useMemo, useState } from "react";
import type { CollectionIpc } from "@/ipc/bindings";
import { filterCollections } from "./sort";
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

export function CollectionPicker({ collections, query, value, onChange }: CollectionPickerProps) {
  const [open, setOpen] = useState<Set<string>>(new Set());

  const filtered = useMemo(() => filterCollections(collections, query), [collections, query]);
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
        const expanded = effectiveOpen.has(n.id);
        return (
          <div
            key={n.id}
            role="treeitem"
            aria-expanded={expanded}
            data-selected={isSelected(n)}
            aria-selected={isSelected(n)}
            onClick={() => onChange({ collectionId: n.collectionId, parentId: n.kind === "collection" ? null : n.id })}
            style={{ paddingLeft: 6 + n.depth * 16 }}
            className={`flex cursor-pointer items-center gap-1 rounded px-1.5 py-1 text-sm hover:bg-accent ${
              isSelected(n) ? "bg-accent" : ""
            }`}
          >
            <button
              type="button"
              aria-label={`${expanded ? "collapse" : "expand"} ${n.name}`}
              onClick={(e) => {
                e.stopPropagation();
                if (filtering) return;
                toggle(n.id);
              }}
              className="w-4 text-muted-foreground"
            >
              {expanded ? "▾" : "▸"}
            </button>
            <span>📁</span>
            <span className="truncate">{n.name}</span>
          </div>
        );
      })}
    </div>
  );
}
