import { X } from "lucide-react";
import { cn } from "@/lib/cn";
import { summarizeStep, TONE_TEXT } from "./stepView";
import type { RowDragProps } from "./dnd";
import type { Step } from "./model";
import { compactFocusRing } from "@/lib/focusRing";
import { useStreamEntry } from "@/features/stream/streamStore";
import { KindBadge } from "@/features/shell/KindBadge";

export function StepRow({
  step,
  index,
  active,
  onSelect,
  onDelete,
  dragProps,
}: {
  step: Step;
  index: number;
  active: boolean;
  onSelect: () => void;
  onDelete: () => void;
  dragProps?: RowDragProps;
}) {
  // A stream step's status and kind badge come from its Stream store entry (its End /
  // Cancel and the kind it ran as); unary steps have no entry and no badge.
  const s = summarizeStep(step, index, useStreamEntry(step.streamId));
  return (
    <div
      role="listitem"
      aria-current={active ? "true" : undefined}
      onClick={onSelect}
      {...dragProps}
      className={cn(
        "group flex cursor-pointer items-center gap-2 px-3 py-1.5 text-xs hover:bg-accent/50",
        active && "bg-accent",
      )}
    >
      <span className="w-4 flex-none text-right font-mono text-[10px] text-muted-foreground">
        {s.number}
      </span>
      <span className={cn("flex-none", TONE_TEXT[s.tone])} aria-hidden>
        ●
      </span>
      <span className="min-w-0 flex-1 truncate font-mono">{s.title}</span>
      <KindBadge kind={s.kind} />
      <span className={cn("flex-none font-mono text-[11px]", TONE_TEXT[s.tone])}>{s.statusText}</span>
      {s.elapsedMs !== null ? (
        <span className="flex-none font-mono text-[10px] text-muted-foreground">{s.elapsedMs}ms</span>
      ) : null}
      <button
        type="button"
        aria-label="delete-step"
        onClick={(e) => {
          e.stopPropagation();
          onDelete();
        }}
        className={`flex-none rounded text-muted-foreground opacity-0 hover:text-destructive group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100 ${compactFocusRing}`}
      >
        <X className="size-3" />
      </button>
    </div>
  );
}
