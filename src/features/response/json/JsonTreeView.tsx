import { useEffect, useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { JsonLineView } from "./JsonLineView";
import { flattenLines } from "./jsonLines";
import type { JsonNode, JsonTree as Tree } from "./jsonTree";

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
  const lines = flattenLines(tree, collapsed);

  const virtualizer = useVirtualizer({
    count: lines.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_H,
    overscan: 16,
  });

  useEffect(() => {
    if (!scrollToId) return;
    const idx = lines.findIndex((l) => l.nodeId === scrollToId);
    if (idx >= 0) virtualizer.scrollToIndex(idx, { align: "center" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scrollToId, lines.length]);

  return (
    <div ref={parentRef} role="tree" className="min-h-0 flex-1 overflow-auto scroll-thin">
      <div style={{ height: virtualizer.getTotalSize(), width: "100%", position: "relative" }}>
        {virtualizer.getVirtualItems().map((vi) => {
          const line = lines[vi.index];
          const node = tree.nodes[line.nodeId];
          return (
            <div
              key={vi.key}
              style={{ position: "absolute", top: 0, left: 0, width: "100%", height: vi.size, transform: `translateY(${vi.start}px)` }}
            >
              <JsonLineView
                line={line}
                node={node}
                lineNumber={vi.index + 1}
                isMatch={matchIds.has(line.nodeId)}
                isActiveMatch={line.nodeId === activeMatchId}
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
