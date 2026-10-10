import { useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { messages } from "@/lib/messages";
import { cn } from "@/lib/cn";
import { formatClock, formatElapsed } from "@/features/stream/format";
import type { Step } from "@/features/workflow/model";
import { TONE_TEXT } from "@/features/workflow/stepView";
import type { HistoryMode } from "./actions";
import { HistoryDetail } from "./HistoryDetail";
import { hitMatches, useHistoryHits, type HistoryToneFilter } from "./rows";

export function TableHistory({
  onHistoryAction,
}: {
  onHistoryAction: (step: Step, mode: HistoryMode) => void;
}) {
  const h = messages.history;
  const hits = useHistoryHits();
  const [open, setOpen] = useState(true);
  const [query, setQuery] = useState("");
  const [tone, setTone] = useState<HistoryToneFilter>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const filtered = hits.filter((hit) => hitMatches(hit, query, tone));
  const selected = filtered.find((hit) => hit.step.id === selectedId) ?? null;

  return (
    <div
      className={cn(
        "flex shrink-0 flex-col border-t border-border bg-background",
        open ? "h-64" : "h-9",
      )}
    >
      <div className="flex h-9 shrink-0 items-center gap-2 overflow-x-auto px-2">
        <Button
          type="button"
          size="xs"
          variant="ghost"
          aria-label="toggle-call-history"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
        >
          {open ? <ChevronDown aria-hidden /> : <ChevronUp aria-hidden />}
          {h.dockTitle}
        </Button>
        {open && (
          <>
            <input
              aria-label="history-filter"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={h.filterPlaceholder}
              className="h-7 w-44 shrink-0 rounded-md border border-input bg-background px-2 text-xs outline-none placeholder:text-muted-foreground focus-visible:ring-1 focus-visible:ring-ring"
            />
            <FilterChip
              label="history-filter-all"
              pressed={tone === "all"}
              onClick={() => setTone("all")}
            >
              {h.filters.all}
            </FilterChip>
            <FilterChip
              label="history-filter-ok"
              pressed={tone === "ok"}
              onClick={() => setTone("ok")}
            >
              {h.filters.ok}
            </FilterChip>
            <FilterChip
              label="history-filter-failed"
              pressed={tone === "failed"}
              onClick={() => setTone("failed")}
            >
              {h.filters.failed}
            </FilterChip>
          </>
        )}
      </div>
      {open && (
        <div className="flex min-h-0 flex-1 border-t border-border">
          <div className="min-w-0 flex-1 overflow-auto">
            <table aria-label="history-table" className="w-full text-xs">
              <thead className="sticky top-0 bg-background">
                <tr className="border-b border-border text-left">
                  <th className="h-7 px-2 font-medium">{h.columns.time}</th>
                  <th className="h-7 px-2 font-medium">{h.columns.method}</th>
                  <th className="h-7 px-2 font-medium">{h.columns.status}</th>
                  <th className="h-7 px-2 font-medium">{h.columns.elapsed}</th>
                  <th className="h-7 px-2 font-medium">{h.columns.address}</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr>
                    <td
                      colSpan={5}
                      className="px-2 py-6 text-center text-muted-foreground"
                    >
                      {hits.length === 0 ? h.empty : h.noMatch}
                    </td>
                  </tr>
                ) : (
                  filtered.map((hit) => {
                    const on = hit.step.id === selected?.step.id;
                    return (
                      <tr
                        key={hit.step.id}
                        aria-label="history-row"
                        aria-selected={on}
                        data-state={on ? "selected" : undefined}
                        onClick={() => setSelectedId(hit.step.id)}
                        className="cursor-pointer border-b border-border hover:bg-muted/50 data-[state=selected]:bg-muted"
                      >
                        <td className="whitespace-nowrap px-2 py-1 font-mono">
                          {formatClock(hit.seenMs)}
                        </td>
                        <td className="max-w-[16rem] truncate px-2 py-1 font-medium">
                          {hit.summary.title}
                        </td>
                        <td
                          className={cn(
                            "whitespace-nowrap px-2 py-1",
                            TONE_TEXT[hit.summary.tone],
                          )}
                        >
                          {hit.summary.statusText}
                        </td>
                        <td className="whitespace-nowrap px-2 py-1 text-muted-foreground">
                          {hit.summary.elapsedMs !== null
                            ? formatElapsed(hit.summary.elapsedMs)
                            : ""}
                        </td>
                        <td className="max-w-[18rem] truncate px-2 py-1 font-mono text-muted-foreground">
                          {hit.step.address}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
          {selected && (
            <div className="w-80 shrink-0 border-l border-border">
              <HistoryDetail
                step={selected.step}
                onRestore={() => onHistoryAction(selected.step, "restore")}
                onRerun={() => onHistoryAction(selected.step, "rerun")}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function FilterChip({
  label,
  pressed,
  onClick,
  children,
}: {
  label: string;
  pressed: boolean;
  onClick: () => void;
  children: string;
}) {
  return (
    <Button
      type="button"
      size="xs"
      variant={pressed ? "secondary" : "ghost"}
      aria-label={label}
      aria-pressed={pressed}
      onClick={onClick}
    >
      {children}
    </Button>
  );
}
