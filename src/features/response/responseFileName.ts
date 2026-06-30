/** Filesystem-safe timestamp `YYYY-MM-DDTHH-MM-SS` in LOCAL time (colons → `-`). */
function localStamp(now: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return (
    `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}` +
    `T${p(now.getHours())}-${p(now.getMinutes())}-${p(now.getSeconds())}`
  );
}

/** Default Save-As filename for a response body: `response-<localstamp>.json`.
 *  Pure — deterministic given `now`. */
export function responseFileName(now: Date): string {
  return `response-${localStamp(now)}.json`;
}
