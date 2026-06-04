import type { JsonTree } from "./jsonTree";

export interface JsonMatch {
  nodeId: string;
  field: "key" | "value";
}

export function findMatches(tree: JsonTree, query: string): JsonMatch[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const out: JsonMatch[] = [];
  for (const id of tree.order) {
    const n = tree.nodes[id];
    if (n.key != null && n.key.toLowerCase().includes(q)) {
      out.push({ nodeId: id, field: "key" });
    }
    if (n.kind !== "object" && n.kind !== "array") {
      const text = n.kind === "string" ? (n.value as string) : String(n.value);
      if (text.toLowerCase().includes(q)) out.push({ nodeId: id, field: "value" });
    }
  }
  return out;
}

/** Ancestor ids from nearest parent up to root (exclusive of `nodeId`). */
export function ancestorsToExpand(tree: JsonTree, nodeId: string): string[] {
  const ids: string[] = [];
  let cur = tree.nodes[nodeId]?.parentId ?? null;
  while (cur) {
    ids.push(cur);
    cur = tree.nodes[cur]?.parentId ?? null;
  }
  return ids;
}
