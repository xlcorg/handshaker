import { useMemo, useRef } from "react";

import { cn } from "@/lib/cn";
import type { ResolutionReportIpc } from "@/ipc/bindings";

import { useVarResolve } from "./useVarResolve";

// Shared font/box metrics so the (transparent-text) input and the highlight backdrop
// lay out identically character-for-character. Any change here must apply to both.
const METRICS = "h-7 px-1 font-mono text-xs leading-7";

interface Segment {
  text: string;
  /** Variable name when this segment is a `{{name}}` token; null for literal text. */
  varName: string | null;
}

function parseSegments(value: string): Segment[] {
  const out: Segment[] = [];
  let last = 0;
  for (const m of value.matchAll(/\{\{([a-zA-Z_][a-zA-Z0-9_-]*)\}\}/g)) {
    const start = m.index ?? 0;
    if (start > last) out.push({ text: value.slice(last, start), varName: null });
    out.push({ text: m[0], varName: m[1] });
    last = start + m[0].length;
  }
  if (last < value.length) out.push({ text: value.slice(last), varName: null });
  return out;
}

export interface VarHighlightInputProps {
  value: string;
  onChange: (value: string) => void;
  /** Resolves the whole template for highlighting + the field tooltip. Omit to disable. */
  resolver?: (t: string) => Promise<ResolutionReportIpc>;
  /** Extra resolve inputs (active env, env revision); change ⇒ re-resolve. */
  resolveKey?: string;
  placeholder?: string;
  ariaLabel?: string;
  /** Sizing for the wrapper (e.g. "w-[22rem]"); the input/backdrop fill it. */
  className?: string;
  onScroll?: () => void;
}

/** A single-line text input that highlights `{{var}}` tokens in place (Postman-style):
 *  resolved variables render green, unresolved/cycle ones red. The real `<input>` sits
 *  transparent on top for editing; a synced backdrop draws the colored text. The full
 *  resolved value is available via the field's title tooltip (works at any length). */
export function VarHighlightInput({
  value, onChange, resolver, resolveKey, placeholder, ariaLabel, className,
}: VarHighlightInputProps) {
  const report = useVarResolve(value, resolver, resolveKey);
  const errorNames = useMemo(() => {
    const s = new Set<string>();
    if (report) {
      for (const v of report.unresolved_vars) s.add(v);
      if (report.cycle_chain) for (const v of report.cycle_chain) s.add(v);
    }
    return s;
  }, [report]);
  const segments = useMemo(() => parseSegments(value), [value]);

  const inputRef = useRef<HTMLInputElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);
  const syncScroll = () => {
    if (backdropRef.current && inputRef.current) {
      backdropRef.current.scrollLeft = inputRef.current.scrollLeft;
    }
  };

  // Field tooltip: the full resolved value on success, the failure detail on error.
  let title: string | undefined;
  if (report) {
    if (report.cycle_chain) title = `Cycle: ${report.cycle_chain.join(" → ")}`;
    else if (report.unresolved_vars.length > 0) title = `Unresolved: ${report.unresolved_vars.join(", ")}`;
    else title = report.resolved;
  }

  return (
    <div className={cn("relative", className)}>
      <div
        ref={backdropRef}
        aria-hidden
        className={cn("pointer-events-none absolute inset-0 overflow-hidden whitespace-pre text-foreground", METRICS)}
      >
        {segments.map((seg, i) =>
          seg.varName == null ? (
            <span key={i}>{seg.text}</span>
          ) : (
            <span
              key={i}
              className={cn(
                "rounded-[3px]",
                report == null
                  ? undefined
                  : errorNames.has(seg.varName)
                    ? "bg-destructive/15 text-destructive"
                    : "bg-emerald-500/15 text-emerald-400",
              )}
            >
              {seg.text}
            </span>
          ),
        )}
      </div>
      <input
        ref={inputRef}
        aria-label={ariaLabel}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onScroll={syncScroll}
        placeholder={placeholder}
        title={title}
        spellCheck={false}
        className={cn(
          "relative w-full border-0 bg-transparent text-transparent caret-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-0",
          METRICS,
        )}
      />
    </div>
  );
}
