export interface ValueSpan {
  nodeId: string;
  start: number; // inclusive char offset
  end: number;   // exclusive char offset
}

/**
 * Innermost span containing `offset`. Spans nest (a container span encloses its
 * children); the innermost is the containing span with the greatest `start`.
 */
export function spanAtOffset(spans: readonly ValueSpan[], offset: number): ValueSpan | null {
  let best: ValueSpan | null = null;
  for (const s of spans) {
    if (offset >= s.start && offset < s.end) {
      if (!best || s.start > best.start) best = s;
    }
  }
  return best;
}
