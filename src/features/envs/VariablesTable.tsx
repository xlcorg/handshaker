import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
  /** Stable per-row id for React keys. Empty-row always has id `"__empty__"`. */
  id: string;
}

function toRows(map: Record<string, string>): Row[] {
  return Object.entries(map).map(([k, v], i) => ({ key: k, value: v, id: `${i}-${k}` }));
}

function fromRows(rows: Row[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const r of rows) {
    if (r.id === "__empty__") continue;
    if (r.key.length === 0) continue;
    out[r.key] = r.value; // dup keys: last wins
  }
  return out;
}

export function VariablesTable({ value, onChange }: VariablesTableProps) {
  const [rows, setRows] = useState<Row[]>(() => toRows(value));

  function updateRow(idx: number, patch: Partial<Row>) {
    const next = rows.map((r, i) => (i === idx ? { ...r, ...patch } : r));
    setRows(next);
    onChange(fromRows(next));
  }

  function deleteRow(idx: number) {
    const next = rows.filter((_, i) => i !== idx);
    setRows(next);
    onChange(fromRows(next));
  }

  function materializeEmpty(key: string) {
    if (key.length === 0) return;
    const next = [...rows, { key, value: "", id: `${rows.length}-${key}` }];
    setRows(next);
    onChange(fromRows(next));
  }

  const seenKeys = new Set<string>();
  const dupFlags = rows.map((r) => {
    const dup = seenKeys.has(r.key);
    seenKeys.add(r.key);
    return dup;
  });

  return (
    <div className="space-y-1">
      <div className="grid grid-cols-[1fr_2fr_auto] gap-2 text-xs text-muted-foreground font-mono">
        <span>key</span>
        <span>value</span>
        <span aria-hidden />
      </div>
      {rows.map((r, i) => {
        const invalid = r.key.length > 0 && !NAME_RE.test(r.key);
        return (
          <div key={r.id}>
            <div className="grid grid-cols-[1fr_2fr_auto] gap-2 items-center group">
              <Input
                value={r.key}
                onChange={(e) => updateRow(i, { key: e.target.value })}
                className={cn("font-mono text-sm", invalid && "border-destructive")}
                title="key must match ^[a-zA-Z_][a-zA-Z0-9_-]*$"
              />
              <Input
                value={r.value}
                onChange={(e) => updateRow(i, { value: e.target.value })}
                className="font-mono text-sm"
              />
              <Button
                variant="ghost"
                size="icon"
                className="opacity-0 group-hover:opacity-100"
                onClick={() => deleteRow(i)}
                aria-label="delete variable"
              >
                ✕
              </Button>
            </div>
            {dupFlags[i] && (
              <div className="text-xs text-amber-500 px-1 mt-0.5">
                duplicate key — last value wins
              </div>
            )}
          </div>
        );
      })}
      {/* Empty-row */}
      <div className="grid grid-cols-[1fr_2fr_auto] gap-2 items-center">
        <Input
          value=""
          placeholder="Add variable"
          onChange={(e) => materializeEmpty(e.target.value)}
          className="font-mono text-sm"
        />
        <Input value="" disabled className="font-mono text-sm" />
        <span aria-hidden />
      </div>
    </div>
  );
}
