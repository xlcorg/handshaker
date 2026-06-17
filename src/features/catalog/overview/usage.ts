/**
 * Compact human labels for a saved request's execution stats, shown in the
 * collection Overview request list. `lastUsedAt` / `now` are epoch milliseconds
 * (what the Send path stamps via `Date.now()`); `now` is injected so the relative
 * formatting is deterministic in tests.
 */

export function relativeTime(ts: number, now: number): string {
  const sec = Math.max(0, Math.floor((now - ts) / 1000));
  if (sec < 45) return "just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day}d ago`;
  return new Date(ts).toLocaleDateString();
}

/** `"3× · 5m ago"`, or `"1×"` when used but missing a timestamp, or `"unused"` at zero. */
export function usageLabel(useCount: number, lastUsedAt: number | null, now: number): string {
  if (useCount <= 0) return "unused";
  const rel = lastUsedAt == null ? "" : ` · ${relativeTime(lastUsedAt, now)}`;
  return `${useCount}×${rel}`;
}
