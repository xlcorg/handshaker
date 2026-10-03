/** Elapsed for the footer: `123ms` under a second, `3.4s` under a minute, else `2m 05s`. */
export function formatElapsed(ms: number): string {
  const v = Math.max(0, ms);
  if (v < 1000) return `${Math.round(v)}ms`;
  if (v < 60_000) return `${(v / 1000).toFixed(1)}s`;
  const m = Math.floor(v / 60_000);
  const s = Math.floor((v % 60_000) / 1000);
  return `${m}m ${String(s).padStart(2, "0")}s`;
}

/** Local wall clock of a message: `HH:MM:SS.mmm`. */
export function formatClock(atMs: number): string {
  const d = new Date(atMs);
  const p2 = (n: number) => String(n).padStart(2, "0");
  return `${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}.${String(d.getMilliseconds()).padStart(3, "0")}`;
}
