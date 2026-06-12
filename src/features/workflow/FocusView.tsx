import { CopyPlus, Save } from "lucide-react";
import { toast } from "sonner";
import { CallPanel } from "./CallPanel";
import { useDraft, useDraftDirty, useDraftOrigin, workflowStore } from "./store";
import { draftBreadcrumb } from "./draftHeader";
import { useCatalog } from "@/features/catalog/CatalogProvider";
import { openSavedRequest } from "@/features/catalog/actions";
import { patchUiState } from "@/features/catalog/uiState";
import { Tooltip } from "@/components/ui/tooltip";
import type { Step } from "./model";

export interface FocusViewProps {
  /** Open the Save dialog for the current unbound draft (Ctrl+S / the Save button). */
  onRequestSave?: () => void;
  /** One-click save of a method row from MethodPicker to the collection. */
  onQuickAddMethod?: (service: string, method: string) => void;
}

export function FocusView({ onRequestSave, onQuickAddMethod }: FocusViewProps = {}) {
  const draft = useDraft();
  const origin = useDraftOrigin();
  const dirty = useDraftDirty();
  const { tree, duplicateItem } = useCatalog();

  // Origin-bound drafts autosave, so duplicating never loses edits — no discard guard.
  async function duplicate() {
    if (!origin) return;
    const item = await duplicateItem(origin.collectionId, origin.requestId);
    if (!item || item.type !== "request") return;
    openSavedRequest(origin.collectionId, item);
    void patchUiState({ active_request: { collection_id: origin.collectionId, item_id: item.id } });
    toast.success(`Duplicated as "${item.name}"`);
  }

  const segments = draft ? draftBreadcrumb(draft, origin, tree) : [];
  const prefix = segments.slice(0, -1);
  const last = segments[segments.length - 1] ?? "";

  return (
    <div className="flex h-full min-h-0 flex-col">
      {draft && (
        <div className="flex h-9 items-center justify-between gap-2 border-b border-border px-3 text-xs">
          <span
            className="flex min-w-0 items-center text-muted-foreground"
            data-testid="draft-breadcrumb"
          >
            {prefix.length > 0 && (
              // Trailing separator uses a non-breaking space: a normal trailing
              // space inside a `white-space: nowrap` flex item is stripped by the
              // browser, which would glue the chevron to the last segment.
              <span className="truncate">{`${prefix.join(" › ")} › `}</span>
            )}
            <span className="flex-none">{last}</span>
          </span>
          {origin ? (
            <span className="flex items-center gap-2">
              <Tooltip content="Duplicate request">
                <button
                  type="button"
                  aria-label="Duplicate request"
                  onClick={() => void duplicate().catch(() => {})}
                  className="inline-flex h-5 w-5 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
                >
                  <CopyPlus className="size-3.5" />
                </button>
              </Tooltip>
              <Tooltip content="Сохранено">
                <span
                  role="status"
                  aria-label="Сохранено"
                  data-testid="autosave-status"
                  className="inline-flex h-5 w-5 items-center justify-center text-muted-foreground/60"
                >
                  <Save className="size-3.5" />
                </span>
              </Tooltip>
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
            onQuickAddMethod={onQuickAddMethod}
          />
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            Нет активного реквеста — выбери метод в сайдбаре.
          </div>
        )}
      </div>
    </div>
  );
}
