import { useEffect, useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { JsonRowView } from "./JsonRowView";
import { flattenVisible, type JsonNode, type JsonTree as Tree } from "./jsonTree";

const ROW_H = 22;

export interface JsonTreeProps {
  tree: Tree;
  collapsed: ReadonlySet<string>;
  matchIds: ReadonlySet<string>;
  activeMatchId: string | null;
  scrollToId: string | null;
  onToggle: (id: string) => void;
  onCopy: (node: JsonNode) => void;
}

export function JsonTree({
  tree, collapsed, matchIds, activeMatchId, scrollToId, onToggle, onCopy,
}: JsonTreeProps) {
  const parentRef = useRef<HTMLDivElement>(null);
  const rows = flattenVisible(tree, collapsed);

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_H,
    overscan: 16,
  });

  useEffect(() => {
    if (!scrollToId) return;
    const idx = rows.findIndex((r) => r.id === scrollToId);
    if (idx >= 0) virtualizer.scrollToIndex(idx, { align: "center" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scrollToId]);

  return (
    <div ref={parentRef} role="tree" className="min-h-0 flex-1 overflow-auto scroll-thin">
      <div style={{ height: virtualizer.getTotalSize(), width: "100%", position: "relative" }}>
        {virtualizer.getVirtualItems().map((vi) => {
          const node = rows[vi.index];
          return (
            <div
              key={node.id}
              style={{ position: "absolute", top: 0, left: 0, width: "100%", height: vi.size, transform: `translateY(${vi.start}px)` }}
            >
              <JsonRowView
                node={node}
                collapsed={collapsed.has(node.id)}
                isMatch={matchIds.has(node.id)}
                isActiveMatch={node.id === activeMatchId}
                onToggle={onToggle}
                onCopy={onCopy}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
