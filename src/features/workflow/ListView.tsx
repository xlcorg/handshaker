import { CallPanel } from "./CallPanel";
import { StepList } from "./StepList";
import { useActiveWorkflow, workflowStore } from "./store";
import { updateStep } from "./reducers";
import type { Step } from "./model";
import { messages } from "@/lib/messages";

export function ListView() {
  const wf = useActiveWorkflow();
  const active = wf.steps.find((s) => s.id === wf.activeStepId) ?? null;

  if (wf.steps.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        {messages.workflow.steps.empty}
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0">
      <div className="w-72 flex-none overflow-auto border-r border-border">
        <StepList />
      </div>
      <div className="min-w-0 flex-1">
        {active ? (
          <CallPanel
            step={active}
            onPatch={(patch: Partial<Step>) =>
              workflowStore.update((w) => updateStep(w, active.id, patch))
            }
          />
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            {messages.workflow.list.pickStep}
          </div>
        )}
      </div>
    </div>
  );
}
