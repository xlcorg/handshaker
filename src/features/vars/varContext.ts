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

/** Max variable suggestions shown in the plain-input dropdown before a "…ещё M" hint.
 *  Baymard autocomplete guidance: keep ≤10 on desktop and avoid the scroll paradigm —
 *  narrow by typing instead. The Monaco body widget is unaffected (native scroll). */
export const MAX_VAR_SUGGESTIONS = 8;

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

/** Replace the open `{{partial` ending at `caret` with `{{name}}`. Returns the new
 *  value and caret (just past `}}`), or null if the caret is not in an open token. */
export function applyVarPick(
  value: string,
  caret: number,
  name: string,
): { value: string; caret: number } | null {
  const tok = openVarToken(value.slice(0, caret));
  if (!tok) return null;
  const head = value.slice(0, tok.tokenStart); // everything before `{{`
  const after = value.slice(caret);
  const closingAhead = after.startsWith("}}");
  const inserted = `{{${name}${closingAhead ? "" : "}}"}`;
  return {
    value: head + inserted + after,
    caret: head.length + inserted.length + (closingAhead ? 2 : 0),
  };
}
