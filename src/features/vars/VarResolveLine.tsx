import { cn } from "@/lib/cn";
import { usePrefs } from "@/lib/use-prefs";
import type { ResolutionReportIpc } from "@/ipc/bindings";

import { hasVars, useVarResolve } from "./useVarResolve";

export { hasVars } from "./useVarResolve";

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
  const [prefs] = usePrefs();
  const report = useVarResolve(value, resolver, resolveKey);

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
      data-vh-scheme={prefs.varHighlight}
      className={cn(
        "text-xs font-mono overflow-hidden text-ellipsis whitespace-nowrap",
        destructive ? "vh-error-text" : "text-muted-foreground",
        className,
      )}
      title={text}
    >
      {text}
    </div>
  );
}
