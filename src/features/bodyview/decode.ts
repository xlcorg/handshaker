// Standard + URL-safe alphabet, optional trailing padding. Whole-value gate
// for the Decode/Save context-menu items. No upper length bound — base64 may be
// short; the backend is the source of truth on whether it actually decodes.
const BASE64_RE = /^[A-Za-z0-9+/_-]+={0,2}$/;

// UUIDs, hex hashes and hex ids are made of hex digits and hyphens — all of which
// are valid base64-alphabet chars, so the charset check alone flags them as
// "base64" (a very common false positive, e.g. an `id` UUID field). Real base64
// of meaningful data is effectively never all hex+hyphen (it almost always carries
// a `g`–`z`/`G`–`Z`/`+`/`/`), so excluding that shape removes the noise with no
// practical false negatives.
const HEX_OR_HYPHEN_RE = /^[0-9a-fA-F-]+$/;

/** True if the entire string could be base64 (length ≥ 4, alphabet-only), and is
 *  not a UUID / hex hash / hex id (all hex+hyphen). */
export function looksLikeBase64(s: string): boolean {
  return s.length >= 4 && BASE64_RE.test(s) && !HEX_OR_HYPHEN_RE.test(s);
}
