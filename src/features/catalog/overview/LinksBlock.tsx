import { useState } from "react";
import { ExternalLink, GripVertical, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/cn";
import { newId } from "@/lib/ids";
import { messages } from "@/lib/messages";
import { DropLine } from "@/features/catalog/DropLine";
import { zoneFromPointer } from "@/features/catalog/dnd";
import { computeReorder } from "@/features/envs/reorder";
import { VarHighlightInput } from "@/features/vars/VarHighlightInput";
import type { VarCandidate } from "@/features/vars/candidates";
import { type LinkResolve, type LinkRow, openLink, useLinkTarget } from "./linkTarget";
import { VAR_FIELD_FRAME, VAR_FIELD_METRICS } from "./varField";

const m = messages.catalog.overview.links;

/** Shared by the header and every row so the columns line up in one edit. */
const GRID_COLS = "grid grid-cols-[14px_1fr_1.4fr_28px_28px]";

type DropZone = "before" | "after";

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
  /** Drop-insertion hint while another row is dragged over this one. */
  dropZone: DropZone | null;
  onGripDragStart: (e: React.DragEvent) => void;
  onRowDragOver: (e: React.DragEvent) => void;
  onRowDrop: (e: React.DragEvent) => void;
  onRowDragEnd: () => void;
}

/** One link row: a drag grip (reorder), name + URL template editors, plus an
 *  open-in-browser action whose target is the URL resolved against the collection
 *  vars + active environment. Only the grip is draggable — the row holds text
 *  inputs, and a fully draggable row would fight text selection. */
function LinkRowItem(props: LinkRowItemProps) {
  const { row, onEdit, onDelete, resolveUrl, resolveKey, variables } = props;
  const { dropZone, onGripDragStart, onRowDragOver, onRowDrop, onRowDragEnd } = props;
  const target = useLinkTarget(row.url, resolveUrl, resolveKey);

  return (
    <div
      onDragOver={onRowDragOver}
      onDrop={onRowDrop}
      onDragEnd={onRowDragEnd}
      // DropLine spans between the row's --bl/--br bleed vars (a sidebar concept);
      // zero them so the line covers exactly this row.
      className={cn(
        "group/link relative gap-x-2 gap-y-0.5 items-center [--bl:0px] [--br:0px]",
        GRID_COLS,
      )}
    >
      {dropZone && <DropLine zone={dropZone} />}
      <button
        type="button"
        draggable
        onDragStart={onGripDragStart}
        aria-label={m.reorderAria}
        className="h-7 inline-flex items-center justify-center cursor-grab text-muted-foreground/40 hover:text-foreground opacity-0 group-hover/link:opacity-100 focus-visible:opacity-100 transition-[opacity,color]"
      >
        <GripVertical size={12} />
      </button>
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
 * Row order is the user-defined link order: rows drag-reorder by the grip (same
 * native-drag idiom as env rows), and every display surface renders in this order.
 */
export function LinksBlock({ rows, onChange, resolveUrl, resolveKey, variables }: LinksBlockProps) {
  const [dragId, setDragId] = useState<string | null>(null);
  const [hint, setHint] = useState<{ id: string; zone: DropZone } | null>(null);

  const add = () => onChange([...rows, { id: newId(), name: "", url: "" }]);

  const upd = (id: string, key: "name" | "url", val: string) =>
    onChange(rows.map((x) => (x.id === id ? { ...x, [key]: val } : x)));

  const del = (id: string) => onChange(rows.filter((x) => x.id !== id));

  const clearDnd = () => {
    setDragId(null);
    setHint(null);
  };

  const dropOn = (targetId: string) => {
    if (dragId && hint?.id === targetId) {
      const ids = rows.map((x) => x.id);
      const next = computeReorder(ids, dragId, targetId, hint.zone);
      if (next) onChange(next.map((id) => rows.find((x) => x.id === id)!));
    }
    clearDnd();
  };

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
        <span />
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
          dropZone={hint?.id === row.id ? hint.zone : null}
          onGripDragStart={(e) => {
            if (e.dataTransfer) {
              e.dataTransfer.effectAllowed = "move";
              e.dataTransfer.setData("text/plain", row.id);
            }
            setDragId(row.id);
          }}
          onRowDragOver={(e) => {
            if (!dragId) return;
            e.preventDefault();
            const zone = zoneFromPointer(
              e.currentTarget.getBoundingClientRect(),
              e.clientY,
              "request",
            ) as DropZone;
            const ids = rows.map((x) => x.id);
            const wouldReorder = computeReorder(ids, dragId, row.id, zone) !== null;
            setHint(wouldReorder ? { id: row.id, zone } : null);
          }}
          onRowDrop={(e) => {
            e.preventDefault();
            dropOn(row.id);
          }}
          onRowDragEnd={clearDnd}
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
