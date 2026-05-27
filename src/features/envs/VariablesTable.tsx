import { Fragment, useState } from "react";

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
import { cn } from "@/lib/cn";

const NAME_RE = /^[a-zA-Z_][a-zA-Z0-9_-]*$/;

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
            <TableHead className="w-1/3 h-8 text-[11px] uppercase tracking-wide font-medium text-muted-foreground">
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
            const invalid = r.key.length > 0 && !NAME_RE.test(r.key);
            return (
              <Fragment key={r.id}>
                <TableRow className="group hover:bg-transparent border-t">
                  <TableCell className="p-0 align-middle">
                    <Input
                      value={r.key}
                      onChange={(e) => updateRow(i, { key: e.target.value })}
                      placeholder={isTrailingEmpty ? "Add variable" : "key"}
                      className={cn(CELL_INPUT_CLASS, invalid && "text-destructive")}
                      title={
                        isTrailingEmpty ? undefined : "key must match ^[a-zA-Z_][a-zA-Z0-9_-]*$"
                      }
                    />
                  </TableCell>
                  <TableCell className="p-0 align-middle border-l">
                    <Input
                      value={r.value}
                      onChange={(e) => updateRow(i, { value: e.target.value })}
                      disabled={isTrailingEmpty}
                      placeholder={isTrailingEmpty ? "" : "value"}
                      className={CELL_INPUT_CLASS}
                    />
                  </TableCell>
                  <TableCell className="w-9 p-0 align-middle border-l text-center">
                    {isTrailingEmpty ? null : (
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 text-muted-foreground hover:text-destructive"
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
