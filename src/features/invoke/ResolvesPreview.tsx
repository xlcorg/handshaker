import { useEffect, useRef, useState } from "react";

import { ipc } from "@/ipc/client";
import type { ResolutionReportIpc } from "@/ipc/bindings";

const DEBOUNCE_MS = 300;

/** Detects whether the body contains any `{{name}}` placeholder. */
function hasVars(body: string): boolean {
  return /\{\{[a-zA-Z_][a-zA-Z0-9_-]*\}\}/.test(body);
}

/** Collapse multi-line / multi-space JSON to a single line for inline display. */
function collapseInline(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

export interface ResolvesPreviewProps {
  body: string;
}

export function ResolvesPreview({ body }: ResolvesPreviewProps) {
  const [report, setReport] = useState<ResolutionReportIpc | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    // If body has no vars, hide preview entirely.
    if (!hasVars(body)) {
      setReport(null);
      return;
    }
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      ipc.varsResolve(body).then(setReport).catch(() => setReport(null));
    }, DEBOUNCE_MS);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [body]);

  if (!hasVars(body) || report === null) return null;

  if (report.cycle_chain) {
    return (
      <div
        className="px-4 py-1 text-xs font-mono text-destructive overflow-hidden text-ellipsis whitespace-nowrap"
        title={`Cycle: ${report.cycle_chain.join(" → ")}`}
      >
        ⚠ Cycle: {report.cycle_chain.join(" → ")}
      </div>
    );
  }
  if (report.unresolved_vars.length > 0) {
    const list = report.unresolved_vars.join(", ");
    return (
      <div
        className="px-4 py-1 text-xs font-mono text-destructive overflow-hidden text-ellipsis whitespace-nowrap"
        title={`Unresolved: ${list}`}
      >
        ⚠ Unresolved: {list}
      </div>
    );
  }
  const inline = collapseInline(report.resolved);
  return (
    <div
      className="px-4 py-1 text-xs font-mono text-muted-foreground overflow-hidden text-ellipsis whitespace-nowrap"
      title={report.resolved}
    >
      → resolves: {inline}
    </div>
  );
}
