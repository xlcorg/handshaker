import { ExternalLink, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/cn";
import { newId } from "@/lib/ids";
import { messages } from "@/lib/messages";
import { ipc } from "@/ipc/client";
import type { ResolutionReportIpc } from "@/ipc/bindings";
import { hasVars, useVarResolve } from "@/features/vars/useVarResolve";

const m = messages.catalog.overview.links;

/** Resolve state of one link's URL — the three states the open action can be in.
 *  `title` is the hover text in every state; only `ready` carries an openable URL. */
type LinkTarget =
  | { kind: "ready"; url: string; title: string }
  | { kind: "pending"; title: string }
  | { kind: "broken"; title: string };

function linkTarget(url: string, report: ResolutionReportIpc | null): LinkTarget {
  // Template-free URLs need no backend round-trip — `useVarResolve` doesn't fire for them.
  if (!hasVars(url)) return { kind: "ready", url, title: m.openHint(url) };
  if (report === null) return { kind: "pending", title: m.resolving };
  if (report.cycle_chain) return { kind: "broken", title: m.cycle(report.cycle_chain) };
  if (report.unresolved_vars.length > 0) {
    return { kind: "broken", title: m.unresolved(report.unresolved_vars) };
  }
  return { kind: "ready", url: report.resolved, title: m.openHint(report.resolved) };
}

/** Shared by the header and every row so the columns line up in one edit. */
const GRID_COLS = "grid grid-cols-[1fr_1.4fr_28px_28px]";

/** Hand a resolved URL to the OS browser. The capability allows http/https only, so a
 *  link with any other scheme is rejected at the seam — surface that, don't swallow it. */
function openLink(url: string) {
  void ipc.openExternal(url).catch(() => toast.error(m.openFailed(url)));
}

/** One editable link row. `id` is a render key only — links are stored as name+url. */
export interface LinkRow {
  id: string;
  name: string;
  url: string;
}

interface LinksBlockProps {
  rows: LinkRow[];
  onChange: (nextRows: LinkRow[]) => void;
  /** Resolves a URL template — the caller bakes the ctx (collection vars + active env) in. */
  resolveUrl: (t: string) => Promise<ResolutionReportIpc>;
  /** Stringified extra resolve inputs (collection vars, active env); change ⇒ re-resolve. */
  resolveKey: string;
}

interface LinkRowItemProps extends Pick<LinksBlockProps, "resolveUrl" | "resolveKey"> {
  row: LinkRow;
  onEdit: (key: "name" | "url", val: string) => void;
  onDelete: () => void;
}

/** One link row: name + URL template editors, plus an open-in-browser action whose
 *  target is the URL resolved against the collection vars + active environment. */
function LinkRowItem({ row, onEdit, onDelete, resolveUrl, resolveKey }: LinkRowItemProps) {
  const report = useVarResolve(row.url, resolveUrl, resolveKey);
  const target = linkTarget(row.url, report);

  return (
    <div className={cn("group/link gap-x-2 gap-y-0.5 items-center", GRID_COLS)}>
      <Input
        value={row.name}
        onChange={(e) => onEdit("name", e.target.value)}
        placeholder={m.namePlaceholder}
        aria-label={m.nameAria}
        className="h-8 text-[12.5px]"
      />
      <Input
        value={row.url}
        onChange={(e) => onEdit("url", e.target.value)}
        placeholder={m.urlPlaceholder}
        aria-label={m.urlAria}
        className={cn("h-8 font-mono text-[12.5px]", target.kind === "broken" && "vh-error-text")}
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
export function LinksBlock({ rows, onChange, resolveUrl, resolveKey }: LinksBlockProps) {
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
