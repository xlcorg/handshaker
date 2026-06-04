import type { HTMLAttributes } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/cn";
import { summarizeStep, type StepTone } from "./stepView";
import type { Step } from "./model";

const TONE_DOT: Record<StepTone, string> = {
  ok: "text-ok",
  error: "text-destructive",
  pending: "text-muted-foreground",
};

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
  dragProps?: HTMLAttributes<HTMLDivElement> & { draggable?: boolean };
}) {
  const s = summarizeStep(step, index);
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
      <span className={cn("flex-none", TONE_DOT[s.tone])} aria-hidden>
        ●
      </span>
      <span className="min-w-0 flex-1 truncate font-mono">{s.title}</span>
      <span className={cn("flex-none font-mono text-[11px]", TONE_DOT[s.tone])}>{s.statusText}</span>
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
        className="flex-none text-muted-foreground opacity-0 hover:text-destructive group-hover:opacity-100"
      >
        <X className="size-3" />
      </button>
    </div>
  );
}
