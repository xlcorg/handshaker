export type JsonKind = "string" | "number" | "boolean" | "null" | "object" | "array";

export interface JsonNode {
  id: string;            // stable DFS id, e.g. "n0", "n1" — deterministic per json
  parentId: string | null;
  key: string | null;    // object-member key; null for root and array elements
  index: number | null;  // array index; null for root and object members
  kind: JsonKind;
  value: unknown;        // raw parsed value (kept for copy / preview)
  depth: number;         // 0 = root
  childIds: string[];    // direct children, in source order
  childCount: number;    // 0 for scalars
}

export interface JsonTree {
  rootId: string | null;
  nodes: Record<string, JsonNode>;
  order: string[];       // full DFS pre-order of every node id
  error: string | null;  // parse error message, or null
}

function kindOf(v: unknown): JsonKind {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  switch (typeof v) {
    case "string": return "string";
    case "number": return "number";
    case "boolean": return "boolean";
    default: return "object";
  }
}

export function parseJsonTree(json: string): JsonTree {
  const nodes: Record<string, JsonNode> = {};
  const order: string[] = [];
  let counter = 0;

  const build = (
    value: unknown,
    key: string | null,
    index: number | null,
    parentId: string | null,
    depth: number,
  ): string => {
    const id = `n${counter++}`;
    const kind = kindOf(value);
    const node: JsonNode = {
      id, parentId, key, index, kind, value, depth, childIds: [], childCount: 0,
    };
    nodes[id] = node;
    order.push(id);

    if (kind === "object") {
      const entries = Object.entries(value as Record<string, unknown>);
      node.childCount = entries.length;
      node.childIds = entries.map(([k, v]) => build(v, k, null, id, depth + 1));
    } else if (kind === "array") {
      const arr = value as unknown[];
      node.childCount = arr.length;
      node.childIds = arr.map((v, i) => build(v, null, i, id, depth + 1));
    }
    return id;
  };

  try {
    const parsed = JSON.parse(json);
    const rootId = build(parsed, null, null, null, 0);
    return { rootId, nodes, order, error: null };
  } catch (e) {
    return { rootId: null, nodes: {}, order: [], error: (e as Error).message };
  }
}
