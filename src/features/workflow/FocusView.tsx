import { CallPanel } from "./CallPanel";
import { useDraft, workflowStore } from "./store";
import type { Step } from "./model";

export function FocusView() {
  const draft = useDraft();

  return (
    <div className="flex h-full min-h-0">
      <div className="min-w-0 flex-1">
        {draft ? (
          <CallPanel
            step={draft}
            onPatch={(patch: Partial<Step>) => workflowStore.updateDraft(patch)}
            onExecuted={(executed: Step) => workflowStore.commitExecutedStep(executed)}
          />
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            Нет активного реквеста — выбери метод в сайдбаре или нажми ⌘K.
          </div>
        )}
      </div>
    </div>
  );
}
