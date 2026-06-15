import type { JsonTree } from "./jsonTree";
import { spanAtOffset, type ValueSpan } from "./spans";

/** Full string value of the innermost string node at `offset`, else null.
 *  Elided nodes keep the full value in the tree, so large base64 comes back whole. */
export function stringValueAtOffset(
  tree: JsonTree,
  spans: readonly ValueSpan[],
  offset: number,
): string | null {
  const span = spanAtOffset(spans, offset);
  if (!span) return null;
  const node = tree.nodes[span.nodeId];
  return node && node.kind === "string" ? (node.value as string) : null;
}
