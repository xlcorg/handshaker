import type { VarCandidate } from "./candidates";

export interface OpenToken {
  /** Text typed after the `{{` up to the caret. */
  partial: string;
  /** Index of the `{{` in the supplied text (doc/string offset). */
  tokenStart: number;
}

/** If the end of `textBefore` sits inside an unclosed `{{…`, return the partial and
 *  the `{{` offset; else null. A brace in the partial means the token is closed/broken. */
export function openVarToken(textBefore: string): OpenToken | null {
  const open = textBefore.lastIndexOf("{{");
  if (open === -1) return null;
  const partial = textBefore.slice(open + 2);
  if (partial.includes("{") || partial.includes("}")) return null;
  return { partial, tokenStart: open };
}

/** Case-insensitive substring filter; prefix matches rank above mid-string matches.
 *  Stable within a rank (Array.sort is stable), so input order is preserved. */
export function filterCandidates(cands: VarCandidate[], partial: string): VarCandidate[] {
  if (partial === "") return cands;
  const p = partial.toLowerCase();
  return cands
    .map((c) => ({ c, idx: c.name.toLowerCase().indexOf(p) }))
    .filter((s) => s.idx !== -1)
    .sort((a, b) => (a.idx === 0 ? 0 : 1) - (b.idx === 0 ? 0 : 1))
    .map((s) => s.c);
}
