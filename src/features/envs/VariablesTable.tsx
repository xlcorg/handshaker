import { Fragment, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { ArrowDown, ArrowDownAZ, ArrowDownZA, ArrowUp, Clock, Trash2 } from "lucide-react";

import { cn } from "@/lib/cn";
import { messages } from "@/lib/messages";
import { VarResolveLine, hasVars } from "@/features/vars/VarResolveLine";
import type { ResolutionReportIpc } from "@/ipc/bindings";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

import { fieldAttr, type EditorIntent, type VisibleRow } from "./useEnvEditor";
import { nextSort, sortDirection, type SortMode } from "./varView";

const m = messages.envs.editor;

export interface VariablesTableProps {
  readonly rows: readonly VisibleRow[];
  readonly sort?: SortMode;
  readonly dispatch: (intent: EditorIntent) => void;
  readonly resolveRow?: (value: string) => Promise<ResolutionReportIpc>;
  readonly resolveKey?: string;
}

// Borderless input that fills its table cell. Padding matches TableHead/TableCell (px-2)
// so column header text aligns visually with the input content below.
const CELL_INPUT_CLASS =
  "h-9 w-full border-0 bg-transparent px-2 shadow-none rounded-none focus-visible:bg-accent/30 focus-visible:ring-0 font-mono text-sm";

// Cap an expanded value at ~7 lines before it scrolls internally — a long JWT
// must not be able to blow up the dialog height.
const VALUE_MAX_PX = 168;

const HEAD_CLASS = "sticky top-0 z-10 h-8 bg-muted text-[11px] uppercase tracking-wide font-medium text-muted-foreground";
// Collapsed table borders stay put when a sticky cell moves, so header rules are inset shadows.
const HEAD_RULE = "shadow-[inset_0_-1px_0_var(--color-border)]";
const HEAD_RULE_LEFT = "shadow-[inset_1px_-1px_0_var(--color-border)]";

const ISSUE_TONE = {
  empty: { ring: "ring-destructive", text: "text-destructive", label: m.keyEmpty },
  duplicate: { ring: "ring-warn", text: "text-warn", label: m.keyDuplicate },
} as const;

/** Value editor cell. Blurred: one clipped line (reads like the old single-line
 *  input). Focused: wraps and auto-grows to fit content, capped at VALUE_MAX_PX,
 *  then scrolls. `scrollHeight` is 0 under jsdom, so the grow is a live-only
 *  behaviour — tests assert this is a <textarea>, not its height. */
function ValueCell({
  field,
  value,
  onChange,
  disabled,
}: {
  field: string;
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [focused, setFocused] = useState(false);
  // True only when the content is genuinely taller than the cap — the one case a
  // scrollbar is actually wanted. Keeping overflow:auto on otherwise lets a
  // spurious scrollbar appear: `scrollHeight` is integer-rounded, so under a
  // fractional webview zoom factor the box ends up ~1px short of its own content
  // and a vertical (then, via the CSS overflow-x→auto rule, horizontal) bar shows.
  const [overflowing, setOverflowing] = useState(false);

  // Grow to fit (capped) while focused; collapse back to the one-row CSS height
  // when blurred. Re-runs on value changes so typing keeps the height in sync.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (focused) {
      el.style.height = "auto";
      const full = el.scrollHeight;
      el.style.height = `${Math.min(full, VALUE_MAX_PX)}px`;
      setOverflowing(full > VALUE_MAX_PX);
    } else {
      el.style.height = "";
      setOverflowing(false);
    }
  }, [focused, value]);

  return (
    <textarea
      ref={ref}
      data-field={field}
      aria-label={m.valueHeader}
      rows={1}
      value={value}
      disabled={disabled}
      placeholder={disabled ? "" : m.valuePlaceholder}
      spellCheck={false}
      onChange={(e) => onChange(e.target.value)}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      // break-all (not break-words): env values are often unbroken tokens/JWTs/URLs that must wrap
      className={cn(
        CELL_INPUT_CLASS,
        "resize-none py-2 align-top",
        // When the value fits under the cap the box is sized exactly to it, so no
        // scrollbar is needed (overflow-hidden clips the sub-pixel zoom remainder
        // invisibly). Only when it overflows do we scroll — vertically only;
        // overflow-x is pinned hidden so it can't compute to `auto` and add a bar.
        focused
          ? overflowing
            ? "overflow-y-auto overflow-x-hidden whitespace-pre-wrap break-all"
            : "overflow-hidden whitespace-pre-wrap break-all"
          : "overflow-hidden whitespace-nowrap",
      )}
    />
  );
}

function KeyCell({ row, dispatch }: { row: VisibleRow; dispatch: VariablesTableProps["dispatch"] }) {
  const issueId = useId();
  const tone = row.issue ? ISSUE_TONE[row.issue] : null;
  return (
    <>
      <div className={cn("relative", tone && ["ring-1 ring-inset", tone.ring])}>
        <Input
          data-field={fieldAttr({ kind: "key", rowId: row.id })}
          aria-label={m.keyHeader}
          aria-invalid={tone !== null}
          aria-describedby={tone ? issueId : undefined}
          value={row.keyText}
          placeholder={m.keyPlaceholder}
          autoComplete="off"
          spellCheck={false}
          onChange={(e) => dispatch({ type: "typeKey", rowId: row.id, text: e.target.value })}
          onBlur={() => dispatch({ type: "commitKey", rowId: row.id, via: "blur" })}
          onKeyDown={(e) => {
            if (e.key !== "Enter" || e.nativeEvent.isComposing) return;
            e.preventDefault();
            dispatch({ type: "commitKey", rowId: row.id, via: "enter" });
          }}
          className={cn(CELL_INPUT_CLASS, "peer relative z-[1] bg-transparent! dark:bg-transparent!")}
        />
        {row.match && (
          // A focused input scrolls its own text, so the backdrop would drift; hide it while editing.
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 flex items-center overflow-hidden whitespace-pre px-2 font-mono text-sm text-transparent peer-focus:invisible"
          >
            {row.keyText.slice(0, row.match.start)}
            <mark className="rounded-[2px] bg-info/40 text-transparent">
              {row.keyText.slice(row.match.start, row.match.end)}
            </mark>
          </div>
        )}
      </div>
      {tone && (
        <p id={issueId} className={cn("px-2 pb-1.5 text-xs", tone.text)}>
          {tone.label}
        </p>
      )}
    </>
  );
}

const MARK = { strokeWidth: 1.5, className: "size-3.5 shrink-0", "aria-hidden": true } as const;

function SortMark({ sort }: { sort: SortMode }) {
  if (sort === "key-asc") return <ArrowDownAZ {...MARK} />;
  if (sort === "key-desc") return <ArrowDownZA {...MARK} />;
  const Arrow = sort === "added-oldest" ? ArrowUp : ArrowDown;
  return (
    <span className="inline-flex items-center" aria-hidden>
      <Clock {...MARK} />
      <Arrow {...MARK} />
    </span>
  );
}

function sortHint(sort: SortMode): string {
  return `${m.sort[sort]}. Next, ${m.sort[nextSort(sort)]}.`;
}

function HeaderButton({ sort, dispatch, children }: { sort: SortMode; dispatch: VariablesTableProps["dispatch"]; children: ReactNode }) {
  const hint = sortHint(sort);
  return (
    <button
      type="button"
      title={hint}
      data-sort-cycle=""
      className="flex h-8 w-full items-center gap-1.5 text-left uppercase tracking-wide"
      onClick={() => dispatch({ type: "setSort", sort: nextSort(sort) })}
    >
      {children}
      <span className="sr-only">{hint}</span>
    </button>
  );
}

export function VariablesTable({ rows, sort = "added-oldest", dispatch, resolveRow, resolveKey }: VariablesTableProps) {
  return (
    <div className="rounded-md border">
      <table data-slot="table" className="w-full table-fixed caption-bottom text-sm">
        <TableHeader className="[&_tr]:border-b-0">
          <TableRow className="hover:bg-transparent">
            <TableHead
              aria-sort={sortDirection(sort)}
              data-sort={sort}
              className={cn(HEAD_CLASS, HEAD_RULE, "w-1/3 rounded-tl-md")}
            >
              <HeaderButton sort={sort} dispatch={dispatch}>
                <span>{m.keyHeader}</span>
                <SortMark sort={sort} />
              </HeaderButton>
            </TableHead>
            <TableHead className={cn(HEAD_CLASS, HEAD_RULE_LEFT)}>{m.valueHeader}</TableHead>
            <TableHead className={cn(HEAD_CLASS, HEAD_RULE_LEFT, "w-9 rounded-tr-md")} aria-label={m.actionsHeader} />
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => {
            const preview = !row.pending && hasVars(row.value) ? resolveRow : undefined;
            return (
              <Fragment key={row.id}>
                <TableRow className={cn("group/envrow hover:bg-transparent", preview && "border-b-0")}>
                  <TableCell className="p-0 align-top whitespace-normal">
                    <KeyCell row={row} dispatch={dispatch} />
                  </TableCell>
                  <TableCell className="p-0 align-top border-l">
                    <ValueCell
                      field={fieldAttr({ kind: "value", rowId: row.id })}
                      value={row.value}
                      onChange={(text) => dispatch({ type: "editValue", rowId: row.id, text })}
                      disabled={row.pending && row.keyText === ""}
                    />
                  </TableCell>
                  <TableCell className="w-9 p-0 align-top border-l text-center">
                    {!row.pending && (
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        className="mt-1.5 text-muted-foreground opacity-0 group-hover/envrow:opacity-100 focus-visible:opacity-100 hover:text-destructive"
                        onClick={() => dispatch({ type: "deleteRow", rowId: row.id })}
                        aria-label={m.deleteVariableAria(row.keyText)}
                      >
                        <Trash2 />
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
                {preview && (
                  <TableRow className="hover:bg-transparent">
                    <TableCell colSpan={3} className="px-2 py-1">
                      <VarResolveLine value={row.value} resolver={preview} resolveKey={resolveKey} />
                    </TableCell>
                  </TableRow>
                )}
              </Fragment>
            );
          })}
        </TableBody>
      </table>
    </div>
  );
}
