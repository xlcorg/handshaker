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
