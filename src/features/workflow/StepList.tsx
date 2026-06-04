import { useActiveWorkflow, workflowStore } from "./store";
import { removeStep, reorderStep, setActiveStep } from "./reducers";
import { makeDragHandlers } from "./dnd";
import { StepRow } from "./StepRow";

const dragFor = makeDragHandlers((from, to) =>
  workflowStore.update((w) => reorderStep(w, from, to)),
);

export function StepList() {
  const wf = useActiveWorkflow();
  return (
    <div role="list" className="flex flex-col py-1">
      {wf.steps.map((step, i) => (
        <StepRow
          key={step.id}
          step={step}
          index={i}
          active={step.id === wf.activeStepId}
          onSelect={() => workflowStore.update((w) => setActiveStep(w, step.id))}
          onDelete={() => workflowStore.update((w) => removeStep(w, step.id))}
          dragProps={dragFor(i)}
        />
      ))}
    </div>
  );
}
