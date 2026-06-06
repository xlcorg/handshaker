import { Fragment } from "react";
import { Button } from "@/components/ui/button";
import { CallPanel } from "./CallPanel";
import { StepRow } from "./StepRow";
import { useActiveWorkflow, workflowStore } from "./store";
import { removeStep, reorderStep, setActiveStep, updateStep } from "./reducers";
import { makeDragHandlers } from "./dnd";
import type { Step } from "./model";

const dragFor = makeDragHandlers((from, to) =>
  workflowStore.update((w) => reorderStep(w, from, to)),
);

export function LedgerView() {
  const wf = useActiveWorkflow();

  if (wf.steps.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        Нет шагов — создай вызов в сайдбаре.
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-9 flex-none items-center justify-end border-b border-border px-3">
        <Button
          size="sm"
          variant="ghost"
          onClick={() => workflowStore.update((w) => setActiveStep(w, null))}
        >
          свернуть все
        </Button>
      </div>
      <div role="list" className="min-h-0 flex-1 overflow-auto">
        {wf.steps.map((step, i) => {
          const active = step.id === wf.activeStepId;
          return (
            <Fragment key={step.id}>
              <StepRow
                step={step}
                index={i}
                active={active}
                onSelect={() => workflowStore.update((w) => setActiveStep(w, step.id))}
                onDelete={() => workflowStore.update((w) => removeStep(w, step.id))}
                dragProps={dragFor(i)}
              />
              {active ? (
                <div className="h-[480px] border-y border-border">
                  <CallPanel
                    step={step}
                    onPatch={(patch: Partial<Step>) =>
                      workflowStore.update((w) => updateStep(w, step.id, patch))
                    }
                  />
                </div>
              ) : null}
            </Fragment>
          );
        })}
      </div>
    </div>
  );
}
