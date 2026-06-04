import { CallPanel } from "./CallPanel";
import { useActiveWorkflow } from "./store";

export function FocusView() {
  const wf = useActiveWorkflow();
  const step = wf.steps.find((s) => s.id === wf.activeStepId) ?? null;

  if (!step) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        Нет активного вызова — выбери метод в сайдбаре или нажми ⌘K.
      </div>
    );
  }

  return <CallPanel step={step} />;
}
