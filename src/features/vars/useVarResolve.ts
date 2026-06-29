import { useEffect, useMemo, useRef, useState } from "react";

import type { ResolutionReportIpc } from "@/ipc/bindings";

const DEBOUNCE_MS = 300;

/** Per-token resolve state for highlight coloring. */
export type VarTokenState = "resolved" | "error" | "dynamic";

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

/** Debounced per-token resolve for token highlight coloring. For each distinct
 *  `{{name}}` a surface token shows, this resolves `{{name}}` ALONE and reports whether
 *  it resolves fully. This is the only correct basis for per-token coloring once chains
 *  exist: a token like `uri-root = {{notes-api-root}}` (env missing the leaf) is itself
 *  defined, so its name never lands in the whole-template report's `unresolved_vars`
 *  (which carries the LEAF `notes-api-root`) — yet the token must read as an error.
 *
 *  Returns name → state; a name still resolving (or with no resolver) is simply absent,
 *  so the caller can leave it uncolored until its state is known. Mirrors `useVarResolve`'s
 *  debounce + resolver-in-ref discipline; the last map is kept during a debounce so colors
 *  don't flicker mid-edit. */
export function useTokenResolveStates(
  names: string[],
  resolver: ((t: string) => Promise<ResolutionReportIpc>) | undefined,
  resolveKey?: string,
): Record<string, VarTokenState> {
  const [states, setStates] = useState<Record<string, VarTokenState>>({});
  const resolverRef = useRef(resolver);
  resolverRef.current = resolver;
  // Stable dep over the order-insensitive name SET (NUL can't occur in a var name).
  const key = useMemo(() => [...names].sort().join("\u0000"), [names]);

  useEffect(() => {
    const resolve = resolverRef.current;
    if (!resolve || names.length === 0) {
      setStates({});
      return;
    }
    let cancelled = false;
    const t = setTimeout(() => {
      void Promise.all(
        names.map((n) =>
          resolve(`{{${n}}}`)
            .then((r): VarTokenState =>
              r.cycle_chain != null || r.unresolved_vars.length > 0
                ? "error"
                : r.dynamic_vars.length > 0
                  ? "dynamic"
                  : "resolved",
            )
            .catch((): VarTokenState => "error"),
        ),
      ).then((results) => {
        if (cancelled) return;
        const next: Record<string, VarTokenState> = {};
        names.forEach((n, i) => {
          next[n] = results[i];
        });
        setStates(next);
      });
    }, DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, resolveKey]);

  return states;
}
