import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tooltip } from "@/components/ui/tooltip";
import { newId } from "@/lib/ids";

export interface VarRow {
  id: string;
  k: string;
  v: string;
}

interface VariablesBlockProps {
  rows: VarRow[];
  onChange: (nextRows: VarRow[]) => void;
}

export function VariablesBlock({ rows, onChange }: VariablesBlockProps) {
  const add = () =>
    onChange([...rows, { id: newId(), k: "", v: "" }]);

  const upd = (id: string, key: "k" | "v", val: string) =>
    onChange(rows.map((x) => (x.id === id ? { ...x, [key]: val } : x)));

  const del = (id: string) =>
    onChange(rows.filter((x) => x.id !== id));

  if (rows.length === 0) {
    return (
      <div className="flex flex-col items-start gap-3">
        <div className="w-full rounded-md border border-dashed border-border/80 px-4 py-6 text-center">
          <p className="text-[12px] text-muted-foreground/65">No collection variables yet.</p>
          <p className="text-[11px] text-muted-foreground/45 mt-0.5">
            Reusable values like base URLs or IDs — referenced as{" "}
            <span className="font-mono">{"{{name}}"}</span> in requests.
          </p>
        </div>
        <Button variant="outline" size="xs" className="gap-1.5" onClick={add}>
          <Plus size={12} /> Add variable
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div className="grid grid-cols-[1fr_1.4fr_28px] gap-2 px-1 pb-0.5">
        <span className="text-[10.5px] font-medium uppercase tracking-wide text-muted-foreground/50">
          Name
        </span>
        <span className="text-[10.5px] font-medium uppercase tracking-wide text-muted-foreground/50">
          Value
        </span>
        <span />
      </div>
      {rows.map((row) => (
        <div key={row.id} className="group/var grid grid-cols-[1fr_1.4fr_28px] gap-2 items-center">
          <Input
            value={row.k}
            onChange={(e) => upd(row.id, "k", e.target.value)}
            placeholder="name"
            className="h-8 font-mono text-[12px]"
          />
          <Input
            value={row.v}
            onChange={(e) => upd(row.id, "v", e.target.value)}
            placeholder="value"
            className="h-8 font-mono text-[12px]"
          />
          <Tooltip content="Remove">
            <button
              onClick={() => del(row.id)}
              aria-label="Remove variable"
              className="h-7 w-7 inline-flex items-center justify-center rounded-md text-muted-foreground/45 hover:text-destructive hover:bg-destructive/10 opacity-0 group-hover/var:opacity-100 focus-visible:opacity-100 transition-[opacity,color,background-color]"
            >
              <Trash2 size={13} />
            </button>
          </Tooltip>
        </div>
      ))}
      <div className="pt-1">
        <Button
          variant="ghost"
          size="xs"
          className="gap-1.5 text-muted-foreground hover:text-foreground -ml-1.5"
          onClick={add}
        >
          <Plus size={12} /> Add variable
        </Button>
      </div>
    </div>
  );
}
