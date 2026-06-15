import { useEffect, useState } from "react";

/** Returns `true` only once `active` has stayed `true` continuously for `delayMs`,
 *  and flips back to `false` immediately when `active` goes false.
 *
 *  This is the "delay" half of the spin-delay anti-flicker pattern
 *  (https://github.com/smeijer/spin-delay): a burst shorter than `delayMs` never
 *  shows the busy state at all, so a fast in-flight call doesn't flash a Cancel /
 *  progress indicator. We intentionally omit spin-delay's `minDuration` — the
 *  callers here gate *actionable* affordances (a Cancel button); holding one past
 *  completion would offer a meaningless cancel. minDuration belongs to spinners. */
export function useBusyDelay(active: boolean, delayMs: number): boolean {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (!active) {
      setShown(false);
      return;
    }
    const t = setTimeout(() => setShown(true), delayMs);
    return () => clearTimeout(t);
  }, [active, delayMs]);
  return shown;
}
