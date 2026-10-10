import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { messages } from "@/lib/messages";
import { cn } from "@/lib/cn";
import { formatClock, formatElapsed } from "@/features/stream/format";
import { useStreamEntry } from "@/features/stream/streamStore";
import { CallPanel } from "@/features/workflow/CallPanel";
import type { Step } from "@/features/workflow/model";
import { updateStep } from "@/features/workflow/reducers";
import { workflowStore } from "@/features/workflow/store";
import { summarizeStep, TONE_TEXT } from "@/features/workflow/stepView";
import type { HistoryMode } from "./actions";
import { useHistoryHits } from "./rows";

export function TimelineHistory({
  onHistoryAction,
  children,
}: {
  onHistoryAction: (step: Step, mode: HistoryMode) => void;
  children: ReactNode;
}) {
  const hits = useHistoryHits();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = hits.find((hit) => hit.step.id === selectedId) ?? null;
  const h = messages.history;

  return (
    <div className="flex h-full min-h-0">
      <aside
        aria-label="history-timeline"
        className="flex h-full w-56 shrink-0 flex-col border-r border-border bg-sidebar"
      >
        <div className="min-h-0 flex-1 overflow-y-auto p-1">
          {hits.length === 0 ? (
            <p className="px-2 py-3 text-xs text-muted-foreground">{h.empty}</p>
          ) : (
            <div className="flex flex-col gap-0.5">
              {hits.map((hit) => {
                const on = hit.step.id === selected?.step.id;
                return (
                  <button
                    key={hit.step.id}
                    type="button"
                    aria-label="history-entry"
                    aria-pressed={on}
                    onClick={() => setSelectedId(hit.step.id)}
                    className={cn(
                      "flex w-full flex-col items-start gap-0.5 rounded-md px-2 py-1.5 text-left text-xs",
                      on
                        ? "bg-sidebar-accent text-sidebar-accent-foreground"
                        : "hover:bg-sidebar-accent/60",
                    )}
                  >
                    <span className="w-full truncate font-medium">
                      {hit.summary.title}
                    </span>
                    <span className="w-full text-muted-foreground">
                      <span className={TONE_TEXT[hit.summary.tone]}>
                        {hit.summary.statusText}
                      </span>
                      {hit.summary.elapsedMs !== null
                        ? ` · ${formatElapsed(hit.summary.elapsedMs)}`
                        : ""}
                      {` · ${formatClock(hit.seenMs)}`}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </aside>
      <div className="min-h-0 min-w-0 flex-1">
        {selected ? (
          <TimelineInspect
            step={selected.step}
            onBack={() => setSelectedId(null)}
            onHistoryAction={onHistoryAction}
          />
        ) : (
          children
        )}
      </div>
    </div>
  );
}

function TimelineInspect({
  step,
  onBack,
  onHistoryAction,
}: {
  step: Step;
  onBack: () => void;
  onHistoryAction: (step: Step, mode: HistoryMode) => void;
}) {
  const h = messages.history;
  const entry = useStreamEntry(step.streamId);
  const summary = summarizeStep(step, 0, entry);
  const run = (mode: HistoryMode) => {
    onHistoryAction(step, mode);
    onBack();
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border px-3">
        <span className="min-w-0 flex-1 truncate text-sm font-medium">
          {summary.title}
        </span>
        <Button
          type="button"
          size="xs"
          variant="outline"
          aria-label="history-restore"
          onClick={() => run("restore")}
        >
          {h.restore}
        </Button>
        <Button
          type="button"
          size="xs"
          aria-label="history-rerun"
          onClick={() => run("rerun")}
        >
          {h.rerun}
        </Button>
        <Button
          type="button"
          size="xs"
          variant="ghost"
          aria-label="history-back"
          onClick={onBack}
        >
          {h.back}
        </Button>
      </div>
      <div className="min-h-0 flex-1">
        <CallPanel
          step={step}
          onPatch={(patch) =>
            workflowStore.update((w) => updateStep(w, step.id, patch))
          }
        />
      </div>
    </div>
  );
}
