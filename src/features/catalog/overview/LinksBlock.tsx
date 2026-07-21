import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tooltip } from "@/components/ui/tooltip";
import { newId } from "@/lib/ids";
import { messages } from "@/lib/messages";

const m = messages.catalog.overview.links;

/** One editable link row. `id` is a render key only — links are stored as name+url. */
export interface LinkRow {
  id: string;
  name: string;
  url: string;
}

interface LinksBlockProps {
  rows: LinkRow[];
  onChange: (nextRows: LinkRow[]) => void;
}

/**
 * Collection links, edited in place. URLs are `{{var}}` templates shown verbatim —
 * resolution and opening land in the follow-up ticket, so a row is text, not a link.
 */
export function LinksBlock({ rows, onChange }: LinksBlockProps) {
  const add = () => onChange([...rows, { id: newId(), name: "", url: "" }]);

  const upd = (id: string, key: "name" | "url", val: string) =>
    onChange(rows.map((x) => (x.id === id ? { ...x, [key]: val } : x)));

  const del = (id: string) => onChange(rows.filter((x) => x.id !== id));

  if (rows.length === 0) {
    return (
      <div className="flex flex-col items-start gap-3">
        <div className="w-full rounded-md border border-dashed border-border/80 px-4 py-6 text-center">
          <p className="text-[12.5px] text-muted-foreground/70">{m.emptyTitle}</p>
          <p className="text-[11px] text-muted-foreground/55 mt-0.5">{m.emptyHint}</p>
        </div>
        <Button variant="outline" size="xs" className="gap-1.5" onClick={add}>
          <Plus size={12} /> {m.add}
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div className="grid grid-cols-[1fr_1.4fr_28px] gap-2 px-1 pb-0.5">
        <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground/55">
          {m.columnName}
        </span>
        <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground/55">
          {m.columnUrl}
        </span>
        <span />
      </div>
      {rows.map((row) => (
        <div
          key={row.id}
          className="group/link grid grid-cols-[1fr_1.4fr_28px] gap-x-2 gap-y-0.5 items-center"
        >
          <Input
            value={row.name}
            onChange={(e) => upd(row.id, "name", e.target.value)}
            placeholder={m.namePlaceholder}
            aria-label={m.nameAria}
            className="h-8 text-[12.5px]"
          />
          <Input
            value={row.url}
            onChange={(e) => upd(row.id, "url", e.target.value)}
            placeholder={m.urlPlaceholder}
            aria-label={m.urlAria}
            className="h-8 font-mono text-[12.5px]"
          />
          <Tooltip content={m.remove}>
            <button
              onClick={() => del(row.id)}
              aria-label={m.removeAria}
              className="h-7 w-7 inline-flex items-center justify-center rounded-md text-muted-foreground/55 hover:text-destructive hover:bg-destructive/10 opacity-0 group-hover/link:opacity-100 focus-visible:opacity-100 transition-[opacity,color,background-color]"
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
          <Plus size={12} /> {m.add}
        </Button>
      </div>
    </div>
  );
}
