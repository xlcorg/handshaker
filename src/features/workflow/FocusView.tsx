import { CallPanel } from "./CallPanel";
import { useDraft, useDraftOrigin, workflowStore } from "./store";
import type { Step } from "./model";

export interface FocusViewProps {
  /** Open the Save dialog for the current unbound draft (Ctrl+S / the Save button). */
  onRequestSave?: () => void;
}

export function FocusView({ onRequestSave }: FocusViewProps = {}) {
  const draft = useDraft();
  const origin = useDraftOrigin();

  return (
    <div className="flex h-full min-h-0 flex-col">
      {draft && (
        <div className="flex h-8 items-center justify-end gap-2 border-b border-border px-3 text-xs">
          {origin ? (
            <span className="text-muted-foreground" data-testid="autosave-status">
              Сохранено
            </span>
          ) : (
            <button
              type="button"
              onClick={() => onRequestSave?.()}
              className="rounded border border-border px-2 py-0.5 hover:bg-accent"
            >
              Сохранить
            </button>
          )}
        </div>
      )}
      <div className="min-h-0 flex-1">
        {draft ? (
          <CallPanel
            step={draft}
            onPatch={(patch: Partial<Step>) => workflowStore.updateDraft(patch)}
            onExecuted={(executed: Step) => workflowStore.commitExecutedStep(executed)}
            editable
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
