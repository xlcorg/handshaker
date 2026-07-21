import { ExternalLink, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/cn";
import { newId } from "@/lib/ids";
import { messages } from "@/lib/messages";
import { VarHighlightInput } from "@/features/vars/VarHighlightInput";
import type { VarCandidate } from "@/features/vars/candidates";
import { type LinkResolve, type LinkRow, openLink, useLinkTarget } from "./linkTarget";
import { VAR_FIELD_FRAME, VAR_FIELD_METRICS } from "./varField";

const m = messages.catalog.overview.links;

/** Shared by the header and every row so the columns line up in one edit. */
const GRID_COLS = "grid grid-cols-[1fr_1.4fr_28px_28px]";

interface LinksBlockProps extends LinkResolve {
  rows: LinkRow[];
  onChange: (nextRows: LinkRow[]) => void;
  /** Variable candidates for `{{`-autocomplete inside the URL field. */
  variables?: VarCandidate[];
}

interface LinkRowItemProps extends LinkResolve {
  row: LinkRow;
  onEdit: (key: "name" | "url", val: string) => void;
  onDelete: () => void;
  variables?: VarCandidate[];
}

/** One link row: name + URL template editors, plus an open-in-browser action whose
 *  target is the URL resolved against the collection vars + active environment. */
function LinkRowItem({ row, onEdit, onDelete, resolveUrl, resolveKey, variables }: LinkRowItemProps) {
  const target = useLinkTarget(row.url, resolveUrl, resolveKey);

  return (
    <div className={cn("group/link gap-x-2 gap-y-0.5 items-center", GRID_COLS)}>
      <Input
        value={row.name}
        onChange={(e) => onEdit("name", e.target.value)}
        placeholder={m.namePlaceholder}
        aria-label={m.nameAria}
        className="h-8 text-[12.5px]"
      />
      {/* URL gets the shared variable treatment (token highlight + resolve preview +
          `{{`-autocomplete), matching the collection Variables value field. Per-token
          coloring inside the field marks broken vars, so no manual error class here. */}
      <VarHighlightInput
        value={row.url}
        onChange={(v) => onEdit("url", v)}
        resolver={resolveUrl}
        resolveKey={resolveKey}
        placeholder={m.urlPlaceholder}
        ariaLabel={m.urlAria}
        metrics={VAR_FIELD_METRICS}
        variables={variables}
        className={VAR_FIELD_FRAME}
      />
      {/* Native `title` rather than the `Tooltip` wrapper: the hover text is the resolved
          URL (or the missing vars) and must stay readable on a non-interactive, blocked
          button — `aria-disabled` keeps the click inert without swallowing hover. */}
      <button
        onClick={() => target.kind === "ready" && openLink(target.url)}
        aria-label={m.openAria}
        aria-disabled={target.kind !== "ready"}
        title={target.title}
        className={cn(
          "h-7 w-7 inline-flex items-center justify-center rounded-md transition-[opacity,color,background-color]",
          target.kind === "ready"
            ? "text-muted-foreground/55 hover:text-foreground hover:bg-accent opacity-0 group-hover/link:opacity-100 focus-visible:opacity-100"
            : "cursor-default",
          target.kind === "broken" && "vh-error-text",
          target.kind === "pending" && "text-muted-foreground/30",
        )}
      >
        <ExternalLink size={13} />
      </button>
      <Tooltip content={m.remove}>
        <button
          onClick={onDelete}
          aria-label={m.removeAria}
          className="h-7 w-7 inline-flex items-center justify-center rounded-md text-muted-foreground/55 hover:text-destructive hover:bg-destructive/10 opacity-0 group-hover/link:opacity-100 focus-visible:opacity-100 transition-[opacity,color,background-color]"
        >
          <Trash2 size={13} />
        </button>
      </Tooltip>
    </div>
  );
}

/**
 * Collection links, edited in place. URLs stay `{{var}}` templates in storage; each row
 * resolves its URL through the var-resolve IPC and opens the resolved target in the
 * system browser. A row whose vars don't resolve is marked and can't be opened.
 */
export function LinksBlock({ rows, onChange, resolveUrl, resolveKey, variables }: LinksBlockProps) {
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
      <div className={cn("gap-2 px-1 pb-0.5", GRID_COLS)}>
        <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground/55">
          {m.columnName}
        </span>
        <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground/55">
          {m.columnUrl}
        </span>
        <span />
        <span />
      </div>
      {rows.map((row) => (
        <LinkRowItem
          key={row.id}
          row={row}
          onEdit={(key, val) => upd(row.id, key, val)}
          onDelete={() => del(row.id)}
          resolveUrl={resolveUrl}
          resolveKey={resolveKey}
          variables={variables}
        />
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
