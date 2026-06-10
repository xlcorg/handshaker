import { Fragment, useLayoutEffect, useRef, useState } from "react";

import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
export interface VariablesTableProps {
  /** Current variables as { key -> value }. */
  value: Record<string, string>;
  /** Called on every change with the next variables map. */
  onChange: (next: Record<string, string>) => void;
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
  const rows: Row[] = Object.entries(map).map(([k, v]) => ({ key: k, value: v, id: nextId() }));
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

  // Grow to fit (capped) while focused; collapse back to the one-row CSS height
  // when blurred. Re-runs on value changes so typing keeps the height in sync.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (focused) {
      el.style.height = "auto";
      el.style.height = `${Math.min(el.scrollHeight, VALUE_MAX_PX)}px`;
    } else {
      el.style.height = "";
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
        focused
          ? "overflow-y-auto whitespace-pre-wrap break-all"
          : "overflow-hidden whitespace-nowrap",
      )}
    />
  );
}

export function VariablesTable({ value, onChange }: VariablesTableProps) {
  const [rows, setRows] = useState<Row[]>(() => initialRows(value));

  function updateRow(idx: number, patch: Partial<Row>) {
    const prevKey = rows[idx].key;
    const isLast = idx === rows.length - 1;
    let next = rows.map((r, i) => (i === idx ? { ...r, ...patch } : r));
    // If the user just started typing in the trailing empty-row, append a new
    // empty-row at the end. The current row keeps its stable id, so React does
    // NOT remount its inputs — focus and caret stay put.
    if (isLast && prevKey === "" && typeof patch.key === "string" && patch.key !== "") {
      next = [...next, { key: "", value: "", id: nextId() }];
    }
    setRows(next);
    onChange(fromRows(next));
  }

  function deleteRow(idx: number) {
    // Never delete the trailing empty-row — it's the input surface for new vars.
    if (idx === rows.length - 1 && rows[idx].key === "") return;
    const next = rows.filter((_, i) => i !== idx);
    setRows(next);
    onChange(fromRows(next));
  }

  // Duplicate detection: skip empty-key rows (multiple "" rows aren't a "duplicate").
  const seenKeys = new Set<string>();
  const dupFlags = rows.map((r) => {
    if (r.key.length === 0) return false;
    const dup = seenKeys.has(r.key);
    seenKeys.add(r.key);
    return dup;
  });

  return (
    <div className="rounded-md border overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent bg-muted/40">
            <TableHead className="w-1/2 h-8 text-[11px] uppercase tracking-wide font-medium text-muted-foreground">
              Key
            </TableHead>
            <TableHead className="h-8 text-[11px] uppercase tracking-wide font-medium text-muted-foreground border-l">
              Value
            </TableHead>
            <TableHead className="w-9 h-8 border-l" aria-label="actions" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r, i) => {
            const isTrailingEmpty = i === rows.length - 1 && r.key === "";
            return (
              <Fragment key={r.id}>
                <TableRow className="group hover:bg-transparent border-t">
                  <TableCell className="p-0 align-top">
                    <Input
                      value={r.key}
                      onChange={(e) => updateRow(i, { key: e.target.value })}
                      placeholder={isTrailingEmpty ? "Add variable" : "key"}
                      className={CELL_INPUT_CLASS}
                    />
                  </TableCell>
                  <TableCell className="p-0 align-top border-l">
                    <ValueCell
                      value={r.value}
                      onChange={(v) => updateRow(i, { value: v })}
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
                        onClick={() => deleteRow(i)}
                        aria-label={`delete variable ${r.key || "(unnamed)"}`}
                      >
                        ✕
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
                {dupFlags[i] && (
                  <TableRow className="hover:bg-transparent border-b-0">
                    <TableCell colSpan={3} className="py-1 px-2 text-xs text-amber-500">
                      duplicate key — last value wins
                    </TableCell>
                  </TableRow>
                )}
              </Fragment>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
