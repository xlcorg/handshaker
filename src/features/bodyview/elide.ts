import { formatBytes } from "@/lib/grpc-status";

export const ELIDE_LIMIT = 4096; // characters; mirrors Postman's CodeMirror line cap
export const PREVIEW_CHARS = 64;

export interface Elision {
  preview: string; // first PREVIEW_CHARS chars of the full value
  label: string;   // "248.0KB" or "image/png · 248.0KB"
}

// `data:<type>/<subtype>[;param=value]*;base64,` — MIME is declared, not guessed.
const DATA_URI_RE = /^data:([\w.+-]+\/[\w.+-]+)(?:;[\w.+-]+=[\w.+-]+)*;base64,/i;

export function elideString(value: string, limit = ELIDE_LIMIT): Elision | null {
  if (value.length <= limit) return null;
  const size = formatBytes(value);
  const m = DATA_URI_RE.exec(value);
  const label = m ? `${m[1]} · ${size}` : size;
  return { preview: value.slice(0, PREVIEW_CHARS), label };
}
