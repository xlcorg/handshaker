// Standard + URL-safe alphabet, optional trailing padding. Whole-value gate
// for the Decode/Save context-menu items. No upper length bound — base64 may be
// short; the backend is the source of truth on whether it actually decodes.
const BASE64_RE = /^[A-Za-z0-9+/_-]+={0,2}$/;

/** True if the entire string could be base64 (length ≥ 4, alphabet-only). */
export function looksLikeBase64(s: string): boolean {
  return s.length >= 4 && BASE64_RE.test(s);
}
