import { Save } from "lucide-react";
import { CallPanel } from "./CallPanel";
import { useDraft, useDraftDirty, useDraftOrigin, workflowStore } from "./store";
import { draftBreadcrumb } from "./draftHeader";
import type { Step } from "./model";

export interface FocusViewProps {
  /** Open the Save dialog for the current unbound draft (Ctrl+S / the Save button). */
  onRequestSave?: () => void;
}

export function FocusView({ onRequestSave }: FocusViewProps = {}) {
  const draft = useDraft();
  const origin = useDraftOrigin();
  const dirty = useDraftDirty();

  return (
    <div className="flex h-full min-h-0 flex-col">
      {draft && (
        <div className="flex h-9 items-center justify-between gap-2 border-b border-border px-3 text-xs">
          <span className="min-w-0 truncate text-muted-foreground" data-testid="draft-breadcrumb">
            {draftBreadcrumb(draft, origin)}
          </span>
          {origin ? (
            <span className="text-muted-foreground" data-testid="autosave-status">
              Сохранено
            </span>
          ) : (
            <button
              type="button"
              aria-label="Сохранить"
              onClick={() => onRequestSave?.()}
              className="inline-flex items-center gap-1.5 rounded border border-border px-2 py-0.5 hover:bg-accent"
            >
              <Save className="size-3.5" />
              Сохранить
              {dirty && (
                <span
                  data-testid="draft-dirty-dot"
                  className="ml-0.5 size-1.5 rounded-full bg-warn"
                  aria-hidden
                />
              )}
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
