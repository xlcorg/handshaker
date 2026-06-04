import { CallPanel } from "./CallPanel";
import { StepRail } from "./StepRail";
import { useActiveWorkflow } from "./store";

export function FocusView() {
  const wf = useActiveWorkflow();
  const step = wf.steps.find((s) => s.id === wf.activeStepId) ?? null;

  return (
    <div className="flex h-full min-h-0">
      {wf.steps.length > 0 ? <StepRail /> : null}
      <div className="min-w-0 flex-1">
        {step ? (
          <CallPanel step={step} />
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            Нет активного вызова — выбери метод в сайдбаре или нажми ⌘K.
          </div>
        )}
      </div>
    </div>
  );
}
