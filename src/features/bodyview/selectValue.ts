import type { JsonTree } from "./jsonTree";
import { spanAtOffset, type ValueSpan } from "./spans";

export interface SelectionRange {
  start: number; // inclusive char offset
  end: number;   // exclusive char offset
}

/** Char-offset range to select when the user double-clicks the value at `offset`.
 *  Strings → inner text (quotes excluded) so a retype stays valid JSON; other
 *  scalars → the whole token. Containers / keys / structural punctuation → null
 *  (the innermost span is an object/array, or no span contains the offset), so the
 *  caller leaves Monaco's default word-select in place. */
export function valueSelectionAt(
  tree: JsonTree,
  spans: readonly ValueSpan[],
  offset: number,
): SelectionRange | null {
  const span = spanAtOffset(spans, offset);
  if (!span) return null;
  const node = tree.nodes[span.nodeId];
  if (!node) return null;
  switch (node.kind) {
    case "string":
      return { start: span.start + 1, end: span.end - 1 };
    case "number":
    case "boolean":
    case "null":
      return { start: span.start, end: span.end };
    default:
      return null; // object / array
  }
}
