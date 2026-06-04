import { cn } from "@/lib/cn";
import { useActiveWorkflow, workflowStore } from "./store";
import { setActiveStep } from "./reducers";
import { summarizeStep, type StepTone } from "./stepView";

const TONE_DOT: Record<StepTone, string> = {
  ok: "bg-ok",
  error: "bg-destructive",
  pending: "bg-muted-foreground",
};

export function StepRail() {
  const wf = useActiveWorkflow();
  return (
    <div className="flex w-10 flex-none flex-col items-center gap-1 overflow-auto border-r border-border py-2">
      {wf.steps.map((step, i) => {
        const s = summarizeStep(step, i);
        const active = step.id === wf.activeStepId;
        return (
          <button
            key={step.id}
            type="button"
            aria-label={`step-${s.number}`}
            title={`${s.number}. ${s.title} — ${s.statusText}`}
            onClick={() => workflowStore.update((w) => setActiveStep(w, step.id))}
            className={cn(
              "flex size-6 flex-none items-center justify-center rounded-full text-[9px]",
              active ? "ring-2 ring-ring" : "hover:bg-accent",
            )}
          >
            <span className={cn("size-2.5 rounded-full", TONE_DOT[s.tone])} aria-hidden />
          </button>
        );
      })}
    </div>
  );
}
