import type { JsonTree } from "./jsonTree";
import { spanAtOffset, type ValueSpan } from "./spans";
import { copyTextForNode } from "./copyValue";

/** Copy text for the innermost value at `offset`, or null if the offset hits no value. */
export function copyAtOffset(tree: JsonTree, spans: readonly ValueSpan[], offset: number): string | null {
  const span = spanAtOffset(spans, offset);
  if (!span) return null;
  const node = tree.nodes[span.nodeId];
  return node ? copyTextForNode(node) : null;
}
