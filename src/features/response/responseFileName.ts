/** Filesystem-safe timestamp `YYYY-MM-DDTHH-MM-SS` in LOCAL time (colons → `-`). */
function localStamp(now: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return (
    `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}` +
    `T${p(now.getHours())}-${p(now.getMinutes())}-${p(now.getSeconds())}`
  );
}

/** Default Save-As filename for a response body: `<method>-<localstamp>.json`,
 *  falling back to `response-<localstamp>.json` when the method is blank. The
 *  method is sanitized to filename-safe chars. Pure — deterministic given `now`. */
export function responseFileName(method: string, now: Date): string {
  const safe = method.replace(/[^A-Za-z0-9_-]/g, "");
  const base = safe.length > 0 ? safe : "response";
  return `${base}-${localStamp(now)}.json`;
}
