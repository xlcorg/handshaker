import { useEffect, useRef, useState } from "react";

import type { ResolutionReportIpc } from "@/ipc/bindings";

const DEBOUNCE_MS = 300;

/** Detects a `{{name}}` placeholder. Mirrors the core `VAR_RE` (`\{\{([^{}]+)\}\}`):
 *  the name is any non-empty run of non-brace chars, so dots/slashes/hyphens count. */
export function hasVars(s: string): boolean {
  return /\{\{[^{}]+\}\}/.test(s);
}

/** Debounced resolve of `value` via `resolver`. Returns the latest report, or null
 *  while `value` has no `{{…}}`, before the first resolve, or when no resolver is given.
 *  Re-resolves on `value`/`resolveKey` change. The resolver is held in a ref so an
 *  inline-lambda prop doesn't refire the effect — re-resolution is driven by the deps. */
export function useVarResolve(
  value: string,
  resolver: ((t: string) => Promise<ResolutionReportIpc>) | undefined,
  resolveKey?: string,
): ResolutionReportIpc | null {
  const [report, setReport] = useState<ResolutionReportIpc | null>(null);
  const resolverRef = useRef(resolver);
  resolverRef.current = resolver;

  useEffect(() => {
    const resolve = resolverRef.current;
    if (!resolve || !hasVars(value)) {
      setReport(null);
      return;
    }
    const t = setTimeout(() => {
      resolve(value).then(setReport).catch(() => setReport(null));
    }, DEBOUNCE_MS);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, resolveKey]);

  return report;
}
