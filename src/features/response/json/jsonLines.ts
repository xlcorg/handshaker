import type { JsonNode, JsonTree } from "./jsonTree";

export type JsonLineKind = "leaf" | "open" | "close" | "folded";

export interface JsonLine {
  nodeId: string;
  kind: JsonLineKind;
  depth: number;
  trailingComma: boolean;
}

/** Is `node` the last child of its parent? Root (no parent) counts as last. */
function isLastChild(tree: JsonTree, node: JsonNode): boolean {
  if (node.parentId === null) return true;
  const parent = tree.nodes[node.parentId];
  return parent.childIds[parent.childIds.length - 1] === node.id;
}

/**
 * Project the node tree into ordered JSON lines.
 * - expanded non-empty container → `open` + children + `close` (close carries the comma)
 * - collapsed non-empty container → single `folded` line
 * - empty container / scalar → single `leaf` line
 * The trailing comma is on a node's last rendered line iff it is not its parent's last child.
 */
export function flattenLines(tree: JsonTree, collapsed: ReadonlySet<string>): JsonLine[] {
  if (tree.rootId === null) return [];
  const out: JsonLine[] = [];

  const walk = (id: string) => {
    const node = tree.nodes[id];
    const isContainer = node.kind === "object" || node.kind === "array";
    const comma = !isLastChild(tree, node);

    if (!isContainer || node.childCount === 0) {
      out.push({ nodeId: id, kind: "leaf", depth: node.depth, trailingComma: comma });
      return;
    }
    if (collapsed.has(id)) {
      out.push({ nodeId: id, kind: "folded", depth: node.depth, trailingComma: comma });
      return;
    }
    out.push({ nodeId: id, kind: "open", depth: node.depth, trailingComma: false });
    for (const c of node.childIds) walk(c);
    out.push({ nodeId: id, kind: "close", depth: node.depth, trailingComma: comma });
  };

  walk(tree.rootId);
  return out;
}
