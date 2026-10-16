import { Fragment, useLayoutEffect, useRef, useState } from "react";
import { ChevronDown, Search, X } from "lucide-react";

import { cn } from "@/lib/cn";
import { messages } from "@/lib/messages";
import { VarResolveLine, hasVars } from "@/features/vars/VarResolveLine";
import type { ResolutionReportIpc } from "@/ipc/bindings";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { varSortId, viewVarRows, type VarSort } from "./varView";

const mv = messages.envs.editor;

const SORT_CHOICES: { id: string; sort: VarSort; label: string }[] = [
  { id: "saved", sort: { by: "saved" }, label: mv.sortSaved },
  { id: "key-asc", sort: { by: "key", dir: "asc" }, label: mv.sortKeyAsc },
  { id: "key-desc", sort: { by: "key", dir: "desc" }, label: mv.sortKeyDesc },
  { id: "value-asc", sort: { by: "value", dir: "asc" }, label: mv.sortValueAsc },
  { id: "value-desc", sort: { by: "value", dir: "desc" }, label: mv.sortValueDesc },
];

export interface VariablesTableProps {
  /** Current variables as { key -> value }. */
  value: Record<string, string>;
  /** Called on every change with the next variables map. */
  onChange: (next: Record<string, string>) => void;
  /** Optional per-row resolve preview (env editor passes an env_vars-overlay resolver). */
  resolveRow?: (value: string) => Promise<ResolutionReportIpc>;
  resolveKey?: string;
}

interface Row {
  key: string;
  value: string;
  /** Stable per-row id used as React key. Created once at row birth and never mutated,
   *  so React reconciles the same DOM element across edits and the input keeps focus. */
  id: string;
}

// Module-level counter; ids never collide across instances or across promotions
// of the trailing empty-row into a real row.
let _idCounter = 0;
function nextId(): string {
  _idCounter += 1;
  return `vrow_${_idCounter}`;
}

function initialRows(map: Record<string, string>): Row[] {
  const rows: Row[] = Object.entries(map).map(([k, v]) => ({
    key: k,
    value: v,
    id: nextId(),
  }));
  // Trailing empty-row is always present at the end.
  rows.push({ key: "", value: "", id: nextId() });
  return rows;
}

function fromRows(rows: Row[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const r of rows) {
    if (r.key.length === 0) continue;
    out[r.key] = r.value; // dup keys: last wins
  }
  return out;
}

// Borderless input that fills its table cell. Padding matches TableHead/TableCell (px-2)
// so column header text aligns visually with the input content below.
const CELL_INPUT_CLASS =
  "h-9 w-full border-0 bg-transparent px-2 shadow-none rounded-none focus-visible:bg-accent/30 focus-visible:ring-0 font-mono text-sm";

// Cap an expanded value at ~7 lines before it scrolls internally — a long JWT
// must not be able to blow up the dialog height.
const VALUE_MAX_PX = 168;

/** Value editor cell. Blurred: one clipped line (reads like the old single-line
 *  input). Focused: wraps and auto-grows to fit content, capped at VALUE_MAX_PX,
 *  then scrolls. `scrollHeight` is 0 under jsdom, so the grow is a live-only
 *  behaviour — tests assert this is a <textarea>, not its height. */
function ValueCell({
  value,
  onChange,
  disabled,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  placeholder?: string;
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
      rows={1}
      value={value}
      disabled={disabled}
      placeholder={placeholder}
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

export function VariablesTable({
  value,
  onChange,
  resolveRow,
  resolveKey,
}: VariablesTableProps) {
  const [rows, setRows] = useState<Row[]>(() => initialRows(value));
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<VarSort>({ by: "saved" });

  function updateRow(id: string, patch: Partial<Row>) {
    const idx = rows.findIndex((r) => r.id === id);
    if (idx < 0) return;
    const prevKey = rows[idx].key;
    const isLast = idx === rows.length - 1;
    let next = rows.map((r, i) => (i === idx ? { ...r, ...patch } : r));
    // If the user just started typing in the trailing empty-row, append a new
    // empty-row at the end. The current row keeps its stable id, so React does
    // NOT remount its inputs — focus and caret stay put.
    if (
      isLast &&
      prevKey === "" &&
      typeof patch.key === "string" &&
      patch.key !== ""
    ) {
      next = [...next, { key: "", value: "", id: nextId() }];
    }
    setRows(next);
    onChange(fromRows(next));
  }

  function deleteRow(id: string) {
    const idx = rows.findIndex((r) => r.id === id);
    if (idx < 0) return;
    // Never delete the trailing empty-row — it's the input surface for new vars.
    if (idx === rows.length - 1 && rows[idx].key === "") return;
    const next = rows.filter((r) => r.id !== id);
    setRows(next);
    onChange(fromRows(next));
  }

  // Duplicate detection: skip empty-key rows (multiple "" rows aren't a "duplicate").
  const dupIds = new Set<string>();
  const seenKeys = new Set<string>();
  for (const r of rows) {
    if (r.key.length === 0) continue;
    if (seenKeys.has(r.key)) dupIds.add(r.id);
    seenKeys.add(r.key);
  }

  const trailing = rows[rows.length - 1];
  const body = rows.slice(0, -1);
  const viewed = viewVarRows(body, query, sort);
  const display = trailing ? [...viewed, trailing] : viewed;
  const filtering = query.trim().length > 0;

  function renderRow(r: Row, isTrailingEmpty: boolean) {
    return (
      <Fragment key={r.id}>
        <TableRow className="group hover:bg-transparent border-t">
          <TableCell className="p-0 align-top">
            <Input
              value={r.key}
              data-var-key={r.key}
              data-var-row={r.id}
              onChange={(e) => updateRow(r.id, { key: e.target.value })}
              placeholder={isTrailingEmpty ? "Add variable" : "key"}
              className={CELL_INPUT_CLASS}
            />
          </TableCell>
          <TableCell className="p-0 align-top border-l">
            <ValueCell
              value={r.value}
              onChange={(v) => updateRow(r.id, { value: v })}
              disabled={isTrailingEmpty}
              placeholder={isTrailingEmpty ? "" : "value"}
            />
          </TableCell>
          <TableCell className="w-9 p-0 align-top border-l text-center">
            {isTrailingEmpty ? null : (
              <Button
                variant="ghost"
                size="icon-sm"
                className="mt-1 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 text-muted-foreground hover:text-destructive"
                onClick={() => deleteRow(r.id)}
                aria-label={`delete variable ${r.key || "(unnamed)"}`}
              >
                ✕
              </Button>
            )}
          </TableCell>
        </TableRow>
        {dupIds.has(r.id) && (
          <TableRow className="hover:bg-transparent border-b-0">
            <TableCell colSpan={3} className="py-1 px-2 text-xs text-warn">
              duplicate key — last value wins
            </TableCell>
          </TableRow>
        )}
        {!isTrailingEmpty && resolveRow && hasVars(r.value) && (
          <TableRow className="hover:bg-transparent border-b-0">
            <TableCell colSpan={3} className="px-2 py-1">
              <VarResolveLine
                value={r.value}
                resolver={resolveRow}
                resolveKey={resolveKey}
              />
            </TableCell>
          </TableRow>
        )}
      </Fragment>
    );
  }

  return (
    <div className="rounded-md border [&_[data-slot=table-container]]:!overflow-visible">
      <div className="sticky top-0 z-10 flex h-11 items-center gap-2 border-b border-border bg-background px-2">
        <div className="flex h-8 min-w-0 flex-1 items-center gap-1.5 rounded-md border border-input bg-background px-2">
          <Search
            className="size-3.5 shrink-0 text-muted-foreground"
            aria-hidden
          />
          <input
            type="text"
            role="searchbox"
            aria-label={mv.filterAria}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={mv.filterPlaceholder}
            className="h-8 w-full bg-transparent font-mono text-xs text-foreground outline-none placeholder:text-muted-foreground"
          />
          {filtering && (
            <button
              type="button"
              aria-label={mv.clearFilter}
              onClick={() => setQuery("")}
              className="text-muted-foreground hover:text-foreground"
            >
              <X className="size-3.5" aria-hidden />
            </button>
          )}
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 shrink-0 gap-1 px-2 text-xs font-normal"
              aria-label={mv.sortAria}
            >
              {SORT_CHOICES.find((choice) => choice.id === varSortId(sort))?.label}
              <ChevronDown className="size-3.5 opacity-60" aria-hidden />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuRadioGroup
              value={varSortId(sort)}
              onValueChange={(id) => {
                const choice = SORT_CHOICES.find((item) => item.id === id);
                if (choice) setSort(choice.sort);
              }}
            >
              {SORT_CHOICES.map((choice) => (
                <DropdownMenuRadioItem key={choice.id} value={choice.id}>
                  {choice.label}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
        <span className="w-16 shrink-0 text-right font-mono text-[10.5px] tabular-nums text-muted-foreground">
          {filtering ? mv.shownOfTotal(viewed.length, body.length) : ""}
        </span>
      </div>
      <Table>
        <TableHeader className="sticky top-11 z-10 bg-muted">
          <TableRow className="hover:bg-transparent bg-muted">
            <TableHead className="w-1/2 h-8 text-[11px] uppercase tracking-wide font-medium text-muted-foreground">
              {mv.columnKey}
            </TableHead>
            <TableHead className="h-8 border-l text-[11px] uppercase tracking-wide font-medium text-muted-foreground">
              {mv.columnValue}
            </TableHead>
            <TableHead className="w-9 h-8 border-l" aria-label="actions" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {filtering && viewed.length === 0 && (
            <TableRow className="hover:bg-transparent">
              <TableCell
                colSpan={3}
                className="py-6 text-center text-xs text-muted-foreground"
              >
                {mv.noMatch(query.trim())}
              </TableCell>
            </TableRow>
          )}
          {display.map((r) => renderRow(r, r.id === trailing?.id))}
        </TableBody>
      </Table>
    </div>
  );
}
