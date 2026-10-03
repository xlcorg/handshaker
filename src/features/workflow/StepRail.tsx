import { cn } from "@/lib/cn";
import { messages } from "@/lib/messages";
import { useActiveWorkflow, workflowStore } from "./store";
import { setActiveStep } from "./reducers";
import type { Step } from "./model";
import { summarizeStep, TONE_BG } from "./stepView";
import { useStreamEntry } from "@/features/stream/streamStore";

export function StepRail() {
  const wf = useActiveWorkflow();
  return (
    <div className="flex w-10 flex-none flex-col items-center gap-1 overflow-auto border-r border-border py-2">
      {wf.steps.map((step, i) => (
        <RailDot key={step.id} step={step} index={i} active={step.id === wf.activeStepId} />
      ))}
    </div>
  );
}

/** One dot per step, each on its own Stream store selector — a frame of stream A never
 *  re-renders B's dot. */
function RailDot({ step, index, active }: { step: Step; index: number; active: boolean }) {
  const s = summarizeStep(step, index, useStreamEntry(step.streamId));
  return (
    <button
      type="button"
      aria-label={`step-${s.number}`}
      title={messages.workflow.step.railTitle(s.number, s.title, s.statusText)}
      onClick={() => workflowStore.update((w) => setActiveStep(w, step.id))}
      className={cn(
        "flex size-6 flex-none items-center justify-center rounded-full text-[9px]",
        active ? "ring-2 ring-ring" : "hover:bg-accent",
      )}
    >
      <span className={cn("size-2.5 rounded-full", TONE_BG[s.tone])} aria-hidden />
    </button>
  );
}
