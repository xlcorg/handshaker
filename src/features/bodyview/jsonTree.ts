export type JsonKind = "string" | "number" | "boolean" | "null" | "object" | "array";

export interface JsonNode {
  id: string;            // stable DFS id, e.g. "n0", "n1"
  parentId: string | null;
  key: string | null;    // object-member key; null for root and array elements
  index: number | null;  // array index; null for root and object members
  kind: JsonKind;
  value: unknown;        // raw parsed value (kept for copy)
  depth: number;         // 0 = root
  childIds: string[];    // direct children, in source order
  childCount: number;    // 0 for scalars
}

export interface JsonTree {
  rootId: string | null;
  nodes: Record<string, JsonNode>;
  order: string[];       // full DFS pre-order of every node id
}
