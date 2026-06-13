import { useLayoutEffect, useMemo, useRef, useState } from "react";

import { cn } from "@/lib/cn";
import { Tooltip } from "@/components/ui/tooltip";
import type { ResolutionReportIpc } from "@/ipc/bindings";

import { useVarResolve } from "./useVarResolve";

// Shared font/box metrics so the (transparent-text) input and the highlight backdrop
// lay out identically character-for-character. Any change here must apply to both.
const METRICS = "h-7 px-1 font-mono text-xs leading-7";
// Breathing room kept between the typed address and the inline resolved chip before we
// decide the chip "fits" (gap + the field's right inset). Px, matches the heuristic only.
const FIT_SLACK = 16;

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
  /** Resolves the whole template for highlighting + the resolved-value display. Omit to disable. */
  resolver?: (t: string) => Promise<ResolutionReportIpc>;
  /** Extra resolve inputs (active env, env revision); change ⇒ re-resolve. */
  resolveKey?: string;
  placeholder?: string;
  ariaLabel?: string;
  /** Sizing for the wrapper (e.g. "w-[22rem]"); the input/backdrop fill it. */
  className?: string;
}

/** A single-line text input that highlights `{{var}}` tokens in place (Postman-style):
 *  resolved variables render green, unresolved/cycle ones red. The real `<input>` sits
 *  transparent on top for editing; a synced backdrop draws the colored text. The full
 *  resolved value shows muted at the field's right edge when it fits, and is always
 *  available via a hover tooltip on the field (so long addresses still expose it). */
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

  const ok = report != null && report.cycle_chain == null && report.unresolved_vars.length === 0;
  const resolvedValue = ok ? report.resolved : "";

  // Tooltip text: the full resolved value on success, the failure detail on error.
  let tooltip: string | undefined;
  if (report) {
    if (report.cycle_chain) tooltip = `Cycle: ${report.cycle_chain.join(" → ")}`;
    else if (report.unresolved_vars.length > 0) tooltip = `Unresolved: ${report.unresolved_vars.join(", ")}`;
    else tooltip = report.resolved;
  }

  const wrapperRef = useRef<HTMLDivElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const chipRef = useRef<HTMLSpanElement>(null);

  const syncScroll = () => {
    if (backdropRef.current && inputRef.current) {
      backdropRef.current.scrollLeft = inputRef.current.scrollLeft;
    }
  };

  // Show the inline resolved chip only when the typed address leaves room for it.
  const [chipFits, setChipFits] = useState(false);
  useLayoutEffect(() => {
    const wrap = wrapperRef.current;
    const back = backdropRef.current;
    const chip = chipRef.current;
    if (!wrap || !back || !chip || !resolvedValue) {
      setChipFits(false);
      return;
    }
    const avail = wrap.clientWidth;
    setChipFits(avail > 0 && back.scrollWidth + chip.scrollWidth + FIT_SLACK <= avail);
  }, [value, resolvedValue, resolveKey]);

  const field = (
    <div ref={wrapperRef} className={cn("relative", className)}>
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
        spellCheck={false}
        className={cn(
          "relative w-full border-0 bg-transparent text-transparent caret-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-0",
          METRICS,
        )}
      />
      {/* Always mounted so its width can be measured; hidden until it actually fits. */}
      {resolvedValue && (
        <span
          ref={chipRef}
          aria-hidden
          className={cn(
            "pointer-events-none absolute right-1 top-0 whitespace-nowrap font-mono text-xs leading-7 text-muted-foreground",
            chipFits ? undefined : "invisible",
          )}
        >
          {resolvedValue}
        </span>
      )}
    </div>
  );

  return tooltip ? (
    <Tooltip content={tooltip}>{field}</Tooltip>
  ) : (
    field
  );
}
