import { useEffect, useRef, useState } from "react";

import { cn } from "@/lib/cn";
import type { ResolutionReportIpc } from "@/ipc/bindings";

const DEBOUNCE_MS = 300;

/** Detects a `{{name}}` placeholder. Same grammar the body preview used; names with
 *  spaces resolve in the core but are not detected here (pre-existing limitation). */
export function hasVars(s: string): boolean {
  return /\{\{[a-zA-Z_][a-zA-Z0-9_-]*\}\}/.test(s);
}

export interface VarResolveLineProps {
  /** The template string being edited (one variable row's value). */
  value: string;
  /** Performs the resolve — callers bake the ctx (collection/env overlays) in. */
  resolver: (t: string) => Promise<ResolutionReportIpc>;
  /** Stringified extra resolve inputs (sibling rows, active env); change ⇒ re-resolve. */
  resolveKey?: string;
  className?: string;
}

/** One-line resolve preview under a variable row:
 *  `→ resolves: …` / `⚠ Unresolved: …` / `⚠ Cycle: …`.
 *  Renders nothing while the value has no `{{…}}` or before the first resolve. */
export function VarResolveLine({ value, resolver, resolveKey, className }: VarResolveLineProps) {
  const [report, setReport] = useState<ResolutionReportIpc | null>(null);
  // Latest resolver in a ref so an inline-lambda prop doesn't refire the effect
  // every render — re-resolution is driven by `value`/`resolveKey` only.
  const resolverRef = useRef(resolver);
  resolverRef.current = resolver;

  useEffect(() => {
    if (!hasVars(value)) {
      setReport(null);
      return;
    }
    const t = setTimeout(() => {
      resolverRef.current(value).then(setReport).catch(() => setReport(null));
    }, DEBOUNCE_MS);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, resolveKey]);

  if (!hasVars(value) || report === null) return null;

  let text: string;
  let destructive = false;
  if (report.cycle_chain) {
    text = `⚠ Cycle: ${report.cycle_chain.join(" → ")}`;
    destructive = true;
  } else if (report.unresolved_vars.length > 0) {
    text = `⚠ Unresolved: ${report.unresolved_vars.join(", ")}`;
    destructive = true;
  } else {
    text = `→ resolves: ${report.resolved}`;
  }

  return (
    <div
      className={cn(
        "text-xs font-mono overflow-hidden text-ellipsis whitespace-nowrap",
        destructive ? "text-destructive" : "text-muted-foreground",
        className,
      )}
      title={text}
    >
      {text}
    </div>
  );
}
