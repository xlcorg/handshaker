import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { Activity, AlertCircle, ChevronDown, ChevronRight, Search, X } from "lucide-react";
import { UnderlineTabs } from "@/components/ui/underline-tabs";
import { BodyView } from "@/features/bodyview/BodyView";
import { ContractView } from "@/features/contract/ContractView";
import { EmptyState } from "@/features/response/EmptyState";
import { KVTable, kvRows } from "@/features/response/KVTable";
import type { ContractInfo } from "@/features/response/ResponsePanel";
import { saveResponseToFile } from "@/features/response/saveResponse";
import { isSaveResponseHotkey } from "@/features/response/saveHotkey";
import { useTabBarStart } from "@/features/response/useTabBarStart";
import { faultFromUnknown, type ClientFault } from "@/features/workflow/netDiagnostics";
import { streamMessage } from "@/ipc/client";
import { cn } from "@/lib/cn";
import { formatByteCount, statusName } from "@/lib/grpc-status";
import { messages } from "@/lib/messages";
import { isTwoWay } from "@/lib/method-kind";
import { isMacOS } from "@/lib/platform";
import { useBusyDelay } from "@/lib/use-busy-delay";
import { canExport, saveStreamMessages } from "./exportActions";
import { formatClock, formatElapsed } from "./format";
import { StreamExportMenu } from "./StreamExportMenu";
import { isLivePhase, streamStore, type MessageMeta, type StreamEntry } from "./streamStore";

type StreamTab = "messages" | "headers" | "trailers" | "contract";

/** Direction chip state: `all` · `in` (Received) · `out` (Sent). */
export type Direction = "all" | "in" | "out";

export interface StreamViewProps {
  /** The step's Stream store entry; null once released (idle pane). */
  entry: StreamEntry | null;
  /** Method contract for the Contract tab; null → three tabs (history panels). */
  contract: ContractInfo | null;
}

/** Response pane of a Stream call: `Messages` (hint = count) · `Headers` (filled at
 *  Stream start) · `Trailers` (filled at Stream end) · `Contract` tabs, an empty header
 *  meta slot, and the footer statusline. The Messages tab stacks the search toolbar
 *  (with `All / Received / Sent` chips on two-way calls), the strip after a rejected
 *  Send message, the red strip after a non-OK End, and the timeline. A post-Open `Fault`
 *  is not rendered here — the call panel shows the unary client-error face for a faulted
 *  entry (a client fault before stream start keeps that face). */
export function StreamView({ entry, contract }: StreamViewProps) {
  const [tab, setTab] = useState<StreamTab>("messages");
  const live = entry !== null && isLivePhase(entry.phase);
  // Same 250 ms gate as the address bar's Send→Cancel swap ⇒ comet and Cancel appear together.
  const showProgress = useBusyDelay(live, 250);

  const { headerRef, barStart } = useTabBarStart(live, tab);

  const count = entry?.messages.length ?? 0;
  const [query, setQuery] = useState("");
  const twoWay = isTwoWay(entry?.kind);
  const [dir, setDir] = useState<Direction>("all");
  const effectiveDir = twoWay ? dir : "all";
  const shown = useMemo(
    () => filterRows(entry?.messages ?? [], query, effectiveDir),
    [entry?.messages, query, effectiveDir],
  );
  // Headers land at Stream start (`Headers` event), trailers at Stream end (`End`).
  const headers = kvRows(entry?.headers);
  const trailers = kvRows(entry?.end?.trailingMetadata);

  // Ctrl/Cmd+S on the pane = Save messages (all inbound rows as one JSON array), the same
  // path as the toolbar menu item; only once the call is terminal. The expanded row's
  // Monaco menu keeps "Save response to file…" for that one message.
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (canExport(entry) && isSaveResponseHotkey(e, isMacOS)) {
      e.preventDefault();
      void saveStreamMessages(entry.id);
    }
  };

  return (
    <div className="flex-1 flex flex-col min-w-0 min-h-0 bg-background relative" onKeyDown={onKeyDown}>
      <div
        ref={headerRef}
        className="h-10 flex-none flex items-center gap-2.5 px-3.5 border-b border-border relative z-10 bg-background/85 backdrop-blur-sm"
      >
        <UnderlineTabs<StreamTab>
          value={tab}
          onChange={setTab}
          busy={showProgress}
          items={[
            { value: "messages", label: messages.stream.tabs.messages, hint: count || undefined },
            { value: "headers", label: messages.response.tabs.headers, hint: headers.length || undefined },
            { value: "trailers", label: messages.response.tabs.trailers, hint: trailers.length || undefined },
            ...(contract ? [{ value: "contract" as const, label: messages.response.tabs.contract }] : []),
          ]}
        />
        {showProgress && (
          <div
            aria-hidden
            data-testid="tab-progress"
            className="hs-tab-progress pointer-events-none absolute inset-x-0 -bottom-px h-[1.5px]"
            style={{ "--bar-start": `${barStart}px` } as CSSProperties}
          />
        )}
      </div>
      {tab === "contract" && contract && (
        <div className="min-h-0 flex-1">
          <ContractView method={contract.method} input={contract.input} output={contract.output} kind={contract.kind} />
        </div>
      )}
      {tab === "headers" && <KVTable rows={headers} />}
      {tab === "trailers" && <KVTable rows={trailers} />}
      {tab === "messages" && entry === null && (
        <EmptyState
          icon={<Activity className="size-[18px]" />}
          title={messages.response.empty.awaitingFirstCall}
          desc={messages.response.empty.awaitingFirstCallDesc}
        />
      )}
      {tab === "messages" && entry !== null && (
        <>
          <StreamToolbar
            query={query}
            onQueryChange={setQuery}
            shown={shown.length}
            total={count}
            filters={twoWay ? <DirectionChips value={dir} onChange={setDir} /> : undefined}
            actions={<StreamExportMenu entry={entry} />}
          />
          {entry.sendFault !== null && (
            <SendFaultStrip fault={entry.sendFault} onDismiss={() => streamStore.clearSendFault(entry.id)} />
          )}
          {entry.end !== null && entry.end.statusCode !== 0 && (
            <ErrorStrip end={entry.end} onSeeTrailers={() => setTab("trailers")} />
          )}
          {/* Keyed on the call id: the expanded row is per call, never inherited by the next Send. */}
          <Timeline key={entry.id} entry={entry} rows={shown} />
        </>
      )}
      {entry !== null && <StreamFooter entry={entry} />}
    </div>
  );
}

/** Rows the toolbar keeps: the direction chip (`all` keeps both) and a case-insensitive
 *  substring search over the preview, newest first. An empty query keeps every row. */
export function filterRows(messages: readonly MessageMeta[], query: string, dir: Direction = "all"): MessageMeta[] {
  const q = query.trim().toLowerCase();
  const rows = [...messages].reverse().filter((m) => dir === "all" || m.dir === dir);
  return q ? rows.filter((m) => m.preview.toLowerCase().includes(q)) : rows;
}

/** `All / Received / Sent` chips — the toolbar's `filters` slot on two-way calls. */
function DirectionChips({ value, onChange }: { value: Direction; onChange: (d: Direction) => void }) {
  const t = messages.stream.toolbar;
  const chips: { dir: Direction; label: string }[] = [
    { dir: "all", label: t.all },
    { dir: "in", label: t.received },
    { dir: "out", label: t.sent },
  ];
  return (
    <div role="group" aria-label={t.directionAria} className="flex items-center gap-0.5">
      {chips.map((c) => (
        <button
          key={c.dir}
          type="button"
          aria-pressed={value === c.dir}
          onClick={() => onChange(c.dir)}
          className={cn(
            "h-5 rounded-full px-2 font-mono text-[10.5px] transition-colors",
            value === c.dir ? "bg-accent text-foreground" : "text-muted-foreground hover:bg-accent/40 hover:text-foreground",
          )}
        >
          {c.label}
        </button>
      ))}
    </div>
  );
}

/** A rejected Send message (`UnresolvedVars` / invalid body / closed stream): the same
 *  message the unary face would carry, as a dismissible strip — the stream stays open and
 *  the rows stay below, so this never replaces the timeline. */
function SendFaultStrip({ fault, onDismiss }: { fault: ClientFault; onDismiss: () => void }) {
  return (
    <div
      role="alert"
      className="flex flex-none items-center gap-2 border-b border-destructive/30 bg-destructive/10 px-3.5 py-1.5 text-xs text-destructive"
    >
      <AlertCircle className="size-3.5 flex-none" aria-hidden />
      <span className="font-medium">{messages.stream.sendFault.title}</span>
      <span aria-hidden>·</span>
      <span className="min-w-0 truncate font-mono text-foreground/85">{fault.message}</span>
      <button
        type="button"
        aria-label={messages.stream.sendFault.dismiss}
        onClick={onDismiss}
        className="ml-auto flex-none rounded p-0.5 hover:bg-destructive/15"
      >
        <X className="size-3.5" aria-hidden />
      </button>
    </div>
  );
}

export interface StreamToolbarProps {
  query: string;
  onQueryChange: (q: string) => void;
  shown: number;
  total: number;
  /** Slot right after the search box — the `All / Received / Sent` chips (ticket 16). */
  filters?: React.ReactNode;
  /** Right-aligned slot — the Save messages / Assemble menu icon (ticket 18). */
  actions?: React.ReactNode;
}

/** Thin strip above the timeline: search box · filter slot · `shown / total` (only while
 *  a filter hides rows) · actions slot (the export menu). No destructive controls live here. */
export function StreamToolbar({ query, onQueryChange, shown, total, filters, actions }: StreamToolbarProps) {
  const filtering = shown !== total;
  return (
    <div className="flex h-8 flex-none items-center gap-1.5 border-b border-border/60 px-2">
      <div className="flex items-center gap-1 rounded-md border border-input px-1.5 text-muted-foreground">
        <Search className="size-3 flex-none" aria-hidden />
        <input
          type="search"
          role="searchbox"
          aria-label={messages.stream.toolbar.searchAria}
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder={messages.stream.toolbar.searchPlaceholder}
          className="h-5 w-44 bg-transparent font-mono text-[11px] text-foreground outline-none placeholder:text-muted-foreground/60"
        />
      </div>
      {filters}
      <span className="ml-auto font-mono text-[10.5px] tabular-nums text-muted-foreground">
        {filtering ? messages.stream.toolbar.shownOfTotal(shown, total) : null}
      </span>
      {actions}
    </div>
  );
}

/** Non-OK Stream end: `<code> <NAME> · message` + "See trailers". Rows stay below it. */
function ErrorStrip({ end, onSeeTrailers }: { end: NonNullable<StreamEntry["end"]>; onSeeTrailers: () => void }) {
  return (
    <div
      role="alert"
      className="flex flex-none items-center gap-2 border-b border-destructive/30 bg-destructive/10 px-3.5 py-1.5 text-xs text-destructive"
    >
      <AlertCircle className="size-3.5 flex-none" aria-hidden />
      <span className="font-mono tabular-nums">{end.statusCode}</span>
      <span className="font-mono font-medium">{statusName(end.statusCode)}</span>
      {end.statusMessage && (
        <>
          <span aria-hidden>·</span>
          <span className="min-w-0 truncate text-foreground/85">{end.statusMessage}</span>
        </>
      )}
      <button
        type="button"
        onClick={onSeeTrailers}
        className="ml-auto flex-none underline-offset-2 hover:underline"
      >
        {messages.stream.strip.seeTrailers}
      </button>
    </div>
  );
}

/** Flat list, newest first, text-only rows. A click expands one row in place into the
 *  read-only body view (Monaco mounts only there); clicking it again collapses. */
export function Timeline({ entry, rows }: { entry: StreamEntry; rows?: MessageMeta[] }) {
  const live = isLivePhase(entry.phase);
  // One numbering covers both directions, so the index alone identifies the row.
  const [expanded, setExpanded] = useState<number | null>(null);
  if (entry.messages.length === 0 && live) {
    // Server-streaming waits for the server; a two-way call waits for the user until
    // half-close, then for the server.
    const empty = !isTwoWay(entry.kind)
      ? { title: messages.stream.empty.awaitingTitle, desc: messages.stream.empty.awaitingDesc }
      : entry.halfClosed
        ? { title: messages.stream.empty.halfClosedTitle, desc: messages.stream.empty.halfClosedDesc }
        : { title: messages.stream.empty.sendTitle, desc: messages.stream.empty.sendDesc };
    return (
      <EmptyState
        icon={<span data-testid="stream-empty-dot" className="h-2.5 w-2.5 rounded-full bg-stream pulse-dot" />}
        title={empty.title}
        desc={empty.desc}
      />
    );
  }
  const visible = rows ?? filterRows(entry.messages, "");
  if (visible.length === 0 && entry.messages.length > 0) {
    return (
      <div className="flex flex-1 items-center justify-center p-6 font-mono text-[11px] text-muted-foreground">
        {messages.stream.empty.noMatch}
      </div>
    );
  }
  return (
    <div className="scroll-thin min-h-0 flex-1 overflow-auto">
      {visible.map((r) => (
        <TimelineRow
          key={`${r.dir}-${r.index}`}
          streamId={entry.id}
          row={r}
          expanded={expanded === r.index}
          onToggle={() => setExpanded((cur) => (cur === r.index ? null : r.index))}
        />
      ))}
    </div>
  );
}

function TimelineRow({
  streamId,
  row,
  expanded,
  onToggle,
}: {
  streamId: string;
  row: MessageMeta;
  expanded: boolean;
  onToggle: () => void;
}) {
  const inbound = row.dir === "in";
  const Chevron = expanded ? ChevronDown : ChevronRight;
  return (
    <div data-testid="stream-row" className={cn("border-b border-border/60", expanded && "bg-accent/20")}>
      <button
        type="button"
        aria-label={messages.stream.row.toggleAria(row.index)}
        aria-expanded={expanded}
        onClick={onToggle}
        className="flex w-full items-center gap-2.5 px-3 py-1.5 text-left font-mono text-[11px] hover:bg-accent/30"
      >
        <Chevron className="size-3 flex-none text-muted-foreground" aria-hidden />
        <span
          aria-label={inbound ? messages.stream.row.received : messages.stream.row.sent}
          className={cn("inline-block w-3 flex-none text-center", inbound ? "text-stream" : "text-muted-foreground")}
        >
          {inbound ? "←" : "→"}
        </span>
        <span className="w-8 flex-none tabular-nums text-muted-foreground">{messages.stream.row.index(row.index)}</span>
        <span className="min-w-0 flex-1 truncate text-foreground/85">{row.preview}</span>
        <span className="flex-none tabular-nums text-muted-foreground">{formatByteCount(row.sizeBytes)}</span>
        <span className="flex-none tabular-nums text-muted-foreground/70">{formatClock(row.atMs)}</span>
      </button>
      {expanded && <ExpandedBody streamId={streamId} row={row} />}
    </div>
  );
}

/** The expanded row: the full pretty JSON in the read-only body view. Small messages
 *  carry it inline (`json`); a `> 64 KiB` one is fetched via `stream_message` on first
 *  expand and cached on the store row, so a later expand is free. The body view's
 *  context menu keeps "Save response to file…" for this one message. */
function ExpandedBody({ streamId, row }: { streamId: string; row: MessageMeta }) {
  const [fetched, setFetched] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const json = row.json ?? fetched;
  useEffect(() => {
    if (row.json !== null) return;
    let alive = true;
    streamMessage(streamId, row.index).then(
      (body) => {
        // Cache on the store even if the row collapsed mid-fetch (no-op once released),
        // so the next expand is free; only the local state is gated on being mounted.
        streamStore.setMessageJson(streamId, row.index, body);
        if (alive) setFetched(body);
      },
      (e: unknown) => {
        if (alive) setError(faultFromUnknown(e).message);
      },
    );
    return () => {
      alive = false;
    };
  }, [streamId, row.index, row.json]);

  return (
    <div className="flex h-72 flex-col overflow-hidden border-t border-border/60">
      {json !== null ? (
        <BodyView mode="response" value={json} onSaveBody={() => void saveResponseToFile(json)} />
      ) : (
        <div className="flex flex-1 items-center justify-center font-mono text-[11px] text-muted-foreground">
          {error !== null ? messages.stream.body.loadFailed(error) : messages.stream.body.loading}
        </div>
      )}
    </div>
  );
}

/** `Date.now()` re-read on a 100 ms tick while `active`; frozen otherwise. */
function useLiveNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(t);
  }, [active]);
  return now;
}

type FooterTone = "live" | "ok" | "error" | "cancelled";

/** Footer statusline (status only): `● OPENING` / `● STREAMING` / `● HALF-CLOSED` · `N msgs`
 *  · bytes · elapsed ticking → `● OK` / `● <code> <NAME>` (red) / `○ Cancelled` with
 *  elapsed frozen. */
export function StreamFooter({ entry }: { entry: StreamEntry }) {
  const live = isLivePhase(entry.phase);
  const now = useLiveNow(live);
  const elapsed = entry.elapsedMs ?? Math.max(0, now - entry.openedAt);

  let tone: FooterTone;
  let dot: React.ReactNode;
  let label: React.ReactNode;
  if (live) {
    tone = "live";
    dot = <span className="h-1.5 w-1.5 rounded-full bg-stream pulse-dot" />;
    const text =
      entry.phase === "opening"
        ? messages.stream.footer.opening
        : entry.halfClosed
          ? messages.stream.footer.halfClosed
          : messages.stream.footer.streaming;
    label = <span className="font-medium text-foreground">{text}</span>;
  } else if (entry.phase === "cancelled") {
    tone = "cancelled";
    dot = <span className="h-1.5 w-1.5 rounded-full border border-muted-foreground" />;
    label = <span className="font-medium text-muted-foreground">{messages.stream.footer.cancelled}</span>;
  } else if (entry.end && entry.end.statusCode !== 0) {
    tone = "error";
    dot = <span className="h-1.5 w-1.5 rounded-full bg-destructive" />;
    label = (
      <>
        <span className="tabular-nums text-muted-foreground">{entry.end.statusCode}</span>
        <span className="font-medium text-foreground">{statusName(entry.end.statusCode)}</span>
      </>
    );
  } else {
    tone = "ok";
    dot = <span className="h-1.5 w-1.5 rounded-full bg-ok" />;
    label = <span className="font-medium text-foreground">{messages.stream.footer.ok}</span>;
  }

  return (
    <div
      data-testid="stream-footer"
      data-tone={tone}
      className="flex h-7 flex-none items-center gap-2 border-t border-border px-3.5 font-mono text-[11px]"
    >
      <span className="flex min-w-0 items-center gap-1.5">
        {dot}
        {label}
      </span>
      <span className="text-muted-foreground">·</span>
      <span className="tabular-nums text-foreground">{messages.stream.footer.msgs(entry.messages.length)}</span>
      <span className="text-muted-foreground">·</span>
      <span className="tabular-nums text-foreground">{formatByteCount(entry.totalBytes)}</span>
      <span className="text-muted-foreground">·</span>
      <span className="tabular-nums text-foreground">{formatElapsed(elapsed)}</span>
    </div>
  );
}
