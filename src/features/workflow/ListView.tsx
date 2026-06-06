import { CallPanel } from "./CallPanel";
import { StepList } from "./StepList";
import { useActiveWorkflow, workflowStore } from "./store";
import { updateStep } from "./reducers";
import type { Step } from "./model";

export function ListView() {
  const wf = useActiveWorkflow();
  const active = wf.steps.find((s) => s.id === wf.activeStepId) ?? null;

  if (wf.steps.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        Нет шагов — создай вызов в сайдбаре.
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
            Выбери шаг слева.
          </div>
        )}
      </div>
    </div>
  );
}
