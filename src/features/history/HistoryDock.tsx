import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import type { PanelImperativeHandle } from "react-resizable-panels";
import { ChevronDown, ChevronUp, RotateCw, Search } from "lucide-react";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import type { CallSummaryIpc } from "@/ipc/bindings";
import { KindBadge } from "@/features/shell/KindBadge";
import { formatElapsed } from "@/features/stream/format";
import { cn } from "@/lib/cn";
import { messages } from "@/lib/messages";
import { readPrefs, usePrefs } from "@/lib/use-prefs";
import { HistoryDetail } from "./HistoryDetail";
import {
  filterRows,
  formatCallTime,
  methodLabelOf,
  statusTextOf,
  verdictOf,
  type HistoryChip,
  type HistoryFilter,
} from "./model";
import type { HistoryIntent } from "./navigate";
import { useHistory } from "./store";

const m = messages.history;
/** The header strip's height. A collapsed dock keeps exactly this much. */
const HEADER_PX = 32;
const COLUMNS = "grid-cols-[7.5rem_minmax(8rem,1.5fr)_minmax(5rem,1fr)_4rem_minmax(6rem,1fr)]";
const CHIPS: readonly HistoryChip[] = ["all", "ok", "failed"];

export interface HistoryDockProps {
  /** Bound by WorkflowApp to `openHistoryCall` behind its discard guard. */
  onOpen: (id: string, intent: HistoryIntent) => void;
  /** The workspace above the dock. It stays mounted while the dock collapses and expands. */
  children: ReactNode;
}

/** The main column split into the workspace and the History dock below it. Expanded state
 *  and size live in prefs (`historyDock`, `historyDockPanel`). */
export function HistoryDock({ onOpen, children }: HistoryDockProps) {
  const [prefs, setPref] = usePrefs();
  const panelRef = useRef<PanelImperativeHandle>(null);
  const expanded = prefs.historyDock;

  useEffect(() => {
    const p = panelRef.current;
    if (!p) return;
    if (expanded) {
      if (p.isCollapsed()) p.expand();
    } else if (!p.isCollapsed()) {
      p.collapse();
    }
  }, [expanded]);

  return (
    <ResizablePanelGroup
      orientation="vertical"
      defaultLayout={{ workspace: 100 - prefs.historyDockPanel, history: prefs.historyDockPanel }}
      onLayoutChanged={(layout) => {
        const pct = layout["history"];
        if (typeof pct === "number" && panelRef.current && !panelRef.current.isCollapsed()) {
          setPref("historyDockPanel", pct);
        }
      }}
    >
      <ResizablePanel id="workspace" minSize="30%">
        {children}
      </ResizablePanel>
      <ResizableHandle />
      <ResizablePanel
        id="history"
        panelRef={panelRef}
        collapsible
        collapsedSize={`${HEADER_PX}px`}
        minSize="15%"
        defaultSize={`${prefs.historyDockPanel}%`}
        onResize={(_size, _id, prev) => {
          // A drag below minSize collapses the panel with no toggle click. Follow it, so
          // the toggle and the body never disagree with what is on screen.
          const collapsed = panelRef.current?.isCollapsed();
          if (prev === undefined || collapsed === undefined) return;
          if (collapsed === readPrefs().historyDock) setPref("historyDock", !collapsed);
        }}
      >
        <DockBody expanded={expanded} onToggle={() => setPref("historyDock", !expanded)} onOpen={onOpen} />
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}

function DockBody({
  expanded,
  onToggle,
  onOpen,
}: {
  expanded: boolean;
  onToggle: () => void;
  onOpen: HistoryDockProps["onOpen"];
}) {
  const state = useHistory();
  const [filter, setFilter] = useState<HistoryFilter>({ text: "", chip: "all" });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const rows = state.phase === "ready" ? state.rows : [];
  const visible = filterRows(rows, filter);
  const selected = visible.find((row) => row.id === selectedId) ?? null;
  const activeId = selected?.id ?? visible[0]?.id ?? null;
  const Chevron = expanded ? ChevronDown : ChevronUp;

  const list =
    state.phase === "loading" ? (
      <Note>{m.dock.loading}</Note>
    ) : state.phase === "failed" ? (
      <Note>{m.dock.loadFailed}</Note>
    ) : rows.length === 0 ? (
      <Note>{m.dock.empty}</Note>
    ) : visible.length === 0 ? (
      <Note>{m.dock.emptyFiltered}</Note>
    ) : (
      <>
        <ColumnHeader />
        <ul onKeyDown={moveFocusOnArrows} className="min-h-0 flex-1 overflow-auto scroll-thin">
          {visible.map((row) => (
            <Row
              key={row.id}
              row={row}
              active={row.id === activeId}
              selected={row.id === selected?.id}
              onSelect={() => setSelectedId(row.id)}
              onOpen={onOpen}
            />
          ))}
        </ul>
      </>
    );

  return (
    <section aria-label={m.dock.title} data-testid="history-dock" className="flex h-full min-h-0 flex-col bg-background">
      <div className="flex h-8 flex-none items-center gap-1.5 border-b border-border/60 px-2">
        <button
          type="button"
          data-testid="history-dock-toggle"
          aria-expanded={expanded}
          onClick={onToggle}
          className="flex h-6 flex-none items-center gap-1 rounded-md px-1.5 text-xs font-medium text-foreground hover:bg-accent/40"
        >
          <Chevron className="size-3.5 text-muted-foreground" aria-hidden />
          {state.phase === "ready" ? m.dock.titleWithCount(rows.length) : m.dock.title}
        </button>
        {expanded && (
          <>
            <div className="ml-2 flex items-center gap-1 rounded-md border border-input px-1.5 text-muted-foreground">
              <Search className="size-3 flex-none" aria-hidden />
              <input
                type="search"
                data-testid="history-filter"
                aria-label={m.filter.label}
                placeholder={m.filter.placeholder}
                value={filter.text}
                onChange={(e) => {
                  const text = e.target.value;
                  setFilter((f) => ({ ...f, text }));
                }}
                className="h-5 w-64 bg-transparent font-mono text-[11px] text-foreground outline-none placeholder:text-muted-foreground/60"
              />
            </div>
            <div role="group" aria-label={m.filter.chipsLabel} className="flex items-center gap-0.5">
              {CHIPS.map((chip) => (
                <button
                  key={chip}
                  type="button"
                  data-testid={`history-chip-${chip}`}
                  aria-pressed={filter.chip === chip}
                  onClick={() => setFilter((f) => ({ ...f, chip }))}
                  className={cn(
                    "h-5 rounded-full px-2 font-mono text-[10.5px] transition-colors",
                    filter.chip === chip
                      ? "bg-accent text-foreground"
                      : "text-muted-foreground hover:bg-accent/40 hover:text-foreground",
                  )}
                >
                  {m.chip[chip]}
                </button>
              ))}
            </div>
          </>
        )}
      </div>
      {expanded && (
        <div className="flex min-h-0 flex-1">
          <div className="flex min-w-0 flex-1 flex-col">{list}</div>
          {selected && <HistoryDetail row={selected} onRerun={() => onOpen(selected.id, "rerun")} />}
        </div>
      )}
    </section>
  );
}

/** The list is one tab stop. Up/Down/Home/End move focus between the rows' open buttons,
 *  and focus selects. */
function moveFocusOnArrows(e: KeyboardEvent<HTMLUListElement>) {
  const items = Array.from(e.currentTarget.children);
  const at = items.findIndex((li) => li.contains(e.target as Node));
  const last = items.length - 1;
  const next =
    e.key === "ArrowDown"
      ? Math.min(at + 1, last)
      : e.key === "ArrowUp"
        ? Math.max(at - 1, 0)
        : e.key === "Home"
          ? 0
          : e.key === "End"
            ? last
            : null;
  if (next === null || at < 0) return;
  e.preventDefault();
  items[next].querySelector<HTMLButtonElement>("[data-testid='history-row-open']")?.focus();
}

function ColumnHeader() {
  const c = m.column;
  return (
    <div
      aria-hidden
      className="flex flex-none border-b border-border/60 text-[10px] font-medium uppercase tracking-wide text-muted-foreground"
    >
      <div className={cn("grid min-w-0 flex-1 gap-3 px-3 py-1", COLUMNS)}>
        <span>{c.time}</span>
        <span>{c.method}</span>
        <span>{c.status}</span>
        <span>{c.elapsed}</span>
        <span>{c.address}</span>
      </div>
      <span className="w-8 flex-none" />
    </div>
  );
}

function Row({
  row,
  active,
  selected,
  onSelect,
  onOpen,
}: {
  row: CallSummaryIpc;
  active: boolean;
  selected: boolean;
  onSelect: () => void;
  onOpen: HistoryDockProps["onOpen"];
}) {
  const label = methodLabelOf(row);
  const time = formatCallTime(row.started_at_ms);
  const ok = verdictOf(row.ending) === "ok";
  return (
    <li className={cn("flex items-stretch border-b border-border/60", selected && "bg-accent/40")}>
      <button
        type="button"
        data-testid="history-row-open"
        tabIndex={active ? 0 : -1}
        aria-label={m.row.openLabel(label, time)}
        onFocus={onSelect}
        onClick={() => {
          onSelect();
          onOpen(row.id, "open");
        }}
        className={cn(
          "grid min-w-0 flex-1 items-center gap-3 px-3 py-1 text-left font-mono text-[11px] hover:bg-accent/30 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring",
          COLUMNS,
        )}
      >
        <span className="truncate tabular-nums text-muted-foreground">{time}</span>
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="truncate text-foreground">{label}</span>
          <KindBadge kind={row.kind} />
        </span>
        <span className="flex min-w-0 items-center gap-1.5">
          <span className={cn("h-1.5 w-1.5 flex-none rounded-full", ok ? "bg-ok" : "bg-destructive")} aria-hidden />
          <span className="truncate text-foreground/85">{statusTextOf(row.ending)}</span>
        </span>
        <span className="tabular-nums text-muted-foreground">{formatElapsed(row.elapsed_ms)}</span>
        <span className="truncate text-muted-foreground">{row.address_template}</span>
      </button>
      <button
        type="button"
        data-testid="history-row-rerun"
        tabIndex={active ? 0 : -1}
        aria-label={m.row.rerunLabel(label)}
        onClick={() => onOpen(row.id, "rerun")}
        className="flex w-8 flex-none items-center justify-center text-muted-foreground hover:bg-accent/40 hover:text-foreground"
      >
        <RotateCw className="size-3" aria-hidden />
      </button>
    </li>
  );
}

function Note({ children }: { children: ReactNode }) {
  return <p className="px-3 py-3 text-xs text-muted-foreground">{children}</p>;
}
