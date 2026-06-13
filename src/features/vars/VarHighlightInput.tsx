import { useLayoutEffect, useMemo, useRef, useState } from "react";

import { cn } from "@/lib/cn";
import { Tooltip } from "@/components/ui/tooltip";
import { usePrefs } from "@/lib/use-prefs";
import type { ResolutionReportIpc } from "@/ipc/bindings";

import { useTokenResolveStates, useVarResolve } from "./useVarResolve";

// Default font/box metrics so the (transparent-text) input and the highlight backdrop
// lay out identically character-for-character. The address bar uses this; hosts with
// taller rows (e.g. the collection variables editor) pass their own via `metrics`.
// Whatever the value, it MUST apply identically to both the input and the backdrop.
const DEFAULT_METRICS = "h-7 px-1 font-mono text-xs leading-7";
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
  // Mirror the core VAR_RE (`\{\{([^{}]+)\}\}`): the name is any non-empty non-brace run.
  for (const m of value.matchAll(/\{\{([^{}]+)\}\}/g)) {
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
  /** Font/box metrics applied identically to the transparent input and the backdrop so
   *  they align char-for-char. Defaults to the address-bar sizing (h-7). Override to
   *  match a host field (e.g. the collection variables editor's taller h-8 rows). */
  metrics?: string;
  /** Sizing/chrome for the wrapper (e.g. "w-[22rem]", or a border+focus-within ring to
   *  frame it like an Input); the input/backdrop fill it. */
  className?: string;
}

/** A single-line text input that highlights `{{var}}` tokens in place (Postman-style):
 *  resolved variables render green, unresolved/cycle ones red. The real `<input>` sits
 *  transparent on top for editing; a synced backdrop draws the colored text. The full
 *  resolved value shows muted at the field's right edge when it fits, and is always
 *  available via a hover tooltip on the field (so long addresses still expose it). */
export function VarHighlightInput({
  value, onChange, resolver, resolveKey, placeholder, ariaLabel,
  metrics = DEFAULT_METRICS, className,
}: VarHighlightInputProps) {
  const [prefs] = usePrefs();
  // Whole-template report drives the field-level resolved-value chip + tooltip + `ok`.
  const report = useVarResolve(value, resolver, resolveKey);
  const segments = useMemo(() => parseSegments(value), [value]);
  // Per-token coloring resolves each surface token on its own — the whole-template
  // report's unresolved_vars are LEAF names, so a chained-but-defined token (uri-root →
  // {{missing}}) would mis-color as resolved if keyed off them. See useTokenResolveStates.
  const tokenNames = useMemo(
    () => [...new Set(segments.flatMap((s) => (s.varName == null ? [] : [s.varName])))],
    [segments],
  );
  const tokenStates = useTokenResolveStates(tokenNames, resolver, resolveKey);

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
  const contentRef = useRef<HTMLSpanElement>(null);
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
    const measure = () => {
      const content = contentRef.current;
      const chip = chipRef.current;
      if (!wrap || !content || !chip || !resolvedValue) {
        setChipFits(false);
        return;
      }
      // `content` is an inline-block span hugging the typed text, so offsetWidth is the
      // real text width (the backdrop box itself is stretched full-width and would not be).
      const avail = wrap.clientWidth;
      setChipFits(avail > 0 && content.offsetWidth + chip.scrollWidth + FIT_SLACK <= avail);
    };
    measure();
    // The field is flex-sized, so a window/pane resize changes clientWidth with no prop
    // change — without re-measuring, a wide-window "fits" verdict goes stale and the chip
    // overlaps the typed address.
    let ro: ResizeObserver | undefined;
    if (wrap && typeof ResizeObserver !== "undefined") {
      ro = new ResizeObserver(measure);
      ro.observe(wrap);
    }
    return () => ro?.disconnect();
  }, [value, resolvedValue, resolveKey]);

  const field = (
    <div ref={wrapperRef} data-vh-scheme={prefs.varHighlight} className={cn("relative", className)}>
      <div
        ref={backdropRef}
        aria-hidden
        className={cn("pointer-events-none absolute inset-0 overflow-hidden whitespace-pre text-foreground", metrics)}
      >
        <span ref={contentRef} className="inline-block">
        {segments.map((seg, i) =>
          seg.varName == null ? (
            <span key={i}>{seg.text}</span>
          ) : (
            <span
              key={i}
              className={cn(
                "rounded-[3px]",
                tokenStates[seg.varName] == null
                  ? undefined
                  : tokenStates[seg.varName] === "error"
                    ? "vh-error"
                    : "vh-resolved",
              )}
            >
              {seg.text}
            </span>
          ),
        )}
        </span>
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
          metrics,
        )}
      />
      {/* Always mounted so its width can be measured; hidden until it actually fits. */}
      {resolvedValue && (
        <span
          ref={chipRef}
          aria-hidden
          className={cn(
            "pointer-events-none absolute inset-y-0 right-1 flex items-center whitespace-nowrap font-mono text-xs text-muted-foreground",
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
