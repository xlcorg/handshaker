import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Search } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { messages } from "@/lib/messages";
import { cn } from "@/lib/cn";
import { formatClock, formatElapsed } from "@/features/stream/format";
import type { Step } from "@/features/workflow/model";
import { TONE_TEXT } from "@/features/workflow/stepView";
import type { HistoryMode } from "./actions";
import { HistoryDetail } from "./HistoryDetail";
import { hitMatches, useHistoryHits } from "./rows";

export function PaletteHistory({
  open,
  onOpenChange,
  onHistoryAction,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onHistoryAction: (step: Step, mode: HistoryMode) => void;
}) {
  const h = messages.history;
  const all = useHistoryHits();
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const shown = all.filter((hit) => hitMatches(hit, query, "all"));
  const active = shown.length === 0 ? 0 : Math.min(highlight, shown.length - 1);
  const current = shown[active] ?? null;

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setHighlight(0);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    listRef.current
      ?.querySelector<HTMLElement>('[aria-selected="true"]')
      ?.scrollIntoView({ block: "nearest" });
  }, [active, query, open]);

  function run(step: Step, mode: HistoryMode) {
    onHistoryAction(step, mode);
    onOpenChange(false);
  }

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlight(Math.min(active + 1, Math.max(shown.length - 1, 0)));
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight(Math.max(active - 1, 0));
      return;
    }
    if (e.key !== "Enter") return;
    const el = e.target as HTMLElement;
    if (
      el.closest("[aria-label='history-restore'], [aria-label='history-rerun']")
    )
      return;
    e.preventDefault();
    if (!current) return;
    run(current.step, "restore");
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="top-[12vh] translate-y-0 gap-0 overflow-hidden p-0 sm:max-w-3xl"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          inputRef.current?.focus();
        }}
      >
        <DialogTitle className="sr-only">{h.dialogTitle}</DialogTitle>
        <DialogDescription className="sr-only">
          {h.dialogDescription}
        </DialogDescription>
        <div
          className="flex h-[min(32rem,70vh)] flex-col"
          onKeyDown={onKeyDown}
        >
          <div className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-3">
            <Search className="size-4 shrink-0 opacity-50" aria-hidden />
            <input
              ref={inputRef}
              aria-label="history-search"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setHighlight(0);
              }}
              placeholder={h.searchPlaceholder}
              className="h-10 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
          </div>
          {shown.length === 0 ? (
            <p className="px-3 py-8 text-center text-xs text-muted-foreground">
              {all.length === 0 ? h.empty : h.noMatch}
            </p>
          ) : (
            <div className="flex min-h-0 flex-1">
              <div
                ref={listRef}
                className="w-72 shrink-0 overflow-y-auto border-r border-border p-1"
              >
                {shown.map((hit, index) => {
                  const on = index === active;
                  return (
                    <button
                      key={hit.step.id}
                      type="button"
                      aria-label="history-hit"
                      aria-selected={on}
                      onClick={() => setHighlight(index)}
                      className={cn(
                        "flex w-full flex-col items-start gap-0.5 rounded-md px-2 py-1.5 text-left text-xs",
                        on
                          ? "bg-accent text-accent-foreground"
                          : "hover:bg-muted",
                      )}
                    >
                      <span className="w-full truncate font-medium">
                        {hit.summary.title}
                      </span>
                      <span className="text-muted-foreground">
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
              <div className="min-w-0 flex-1">
                {current && (
                  <HistoryDetail
                    step={current.step}
                    onRestore={() => run(current.step, "restore")}
                    onRerun={() => run(current.step, "rerun")}
                  />
                )}
              </div>
            </div>
          )}
          <div className="flex shrink-0 items-center gap-3 border-t border-border px-3 py-2 text-[11px] text-muted-foreground">
            <span>{h.footerNavigate}</span>
            <span>{h.footerRestore}</span>
            <span>{h.footerClose}</span>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
