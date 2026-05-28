import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";

export interface MetadataRow {
  k: string;
  v: string;
}

export interface MetadataViewProps {
  rows: MetadataRow[];
  onChange: (next: MetadataRow[]) => void;
}

const VAR_RE = /\{\{[^}]+\}\}/;

export function MetadataView({ rows, onChange }: MetadataViewProps) {
  function updateRow(i: number, patch: Partial<MetadataRow>) {
    const next = rows.slice();
    next[i] = { ...next[i], ...patch };
    onChange(next);
  }
  function removeRow(i: number) {
    onChange(rows.filter((_, j) => j !== i));
  }
  function addRow() {
    onChange([...rows, { k: "", v: "" }]);
  }
  return (
    <div className="p-3.5">
      <div className="rounded-md border border-border overflow-hidden bg-card">
        <div className="grid grid-cols-[1fr_1.6fr_28px] border-b border-border bg-muted/30">
          <div className="px-3 py-1.5 label-cap">Key</div>
          <div className="px-3 py-1.5 label-cap">Value</div>
          <div />
        </div>
        {rows.map((row, i) => (
          <div key={i} className="grid grid-cols-[1fr_1.6fr_28px] border-b border-border/60 last:border-0">
            <div className="px-3 h-8 flex items-center">
              <input
                value={row.k}
                onChange={(e) => updateRow(i, { k: e.target.value })}
                placeholder="x-request-id"
                className="w-full bg-transparent font-mono text-xs focus:outline-none placeholder:text-muted-foreground"
              />
            </div>
            <div className={cn("px-3 h-8 flex items-center", VAR_RE.test(row.v) && "text-[hsl(var(--syntax-num))]")}>
              <input
                value={row.v}
                onChange={(e) => updateRow(i, { v: e.target.value })}
                placeholder="value or {{var}}"
                className="w-full bg-transparent font-mono text-xs focus:outline-none placeholder:text-muted-foreground"
              />
            </div>
            <div className="flex items-center justify-center">
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                onClick={() => removeRow(i)}
                aria-label="Remove row"
                className="text-muted-foreground hover:text-destructive"
              >
                <Trash2 className="size-2.5" />
              </Button>
            </div>
          </div>
        ))}
        <button
          type="button"
          onClick={addRow}
          className="grid grid-cols-[1fr_1.6fr_28px] w-full hover:bg-accent/40 transition-colors text-left"
        >
          <div className="px-3 h-8 flex items-center text-xs text-muted-foreground">Add key…</div>
          <div />
          <div className="flex items-center justify-center text-muted-foreground">
            <Plus className="size-2.5" />
          </div>
        </button>
      </div>
    </div>
  );
}
