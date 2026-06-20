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
import { compactFocusRing } from "@/lib/focusRing";
import { messages } from "@/lib/messages";

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
  const { tree, duplicateItem, bumpUsage } = useCatalog();

  // Origin-bound drafts autosave, so duplicating never loses edits — no discard guard.
  async function duplicate() {
    if (!origin) return;
    const item = await duplicateItem(origin.collectionId, origin.requestId);
    if (!item || item.type !== "request") return;
    openSavedRequest(origin.collectionId, item);
    void patchUiState({ active_request: { collection_id: origin.collectionId, item_id: item.id } });
    toast.success(messages.workflow.focus.duplicatedAs(item.name));
  }

  // Auth of the origin collection — CallPanel falls back to it when the step's own
  // auth is none (request-level auth has no editor; collections carry the config).
  const originAuth = origin ? tree.find((c) => c.id === origin.collectionId)?.auth : undefined;
  const originVars = origin ? tree.find((c) => c.id === origin.collectionId)?.variables : undefined;

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
              <Tooltip content={messages.workflow.focus.duplicateRequest}>
                <button
                  type="button"
                  aria-label={messages.workflow.focus.duplicateRequest}
                  onClick={() => void duplicate().catch(() => {})}
                  className={`inline-flex h-5 w-5 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground ${compactFocusRing}`}
                >
                  <CopyPlus className="size-3.5" />
                </button>
              </Tooltip>
              <Tooltip content={messages.workflow.focus.saved}>
                <span
                  role="status"
                  aria-label={messages.workflow.focus.saved}
                  data-testid="autosave-status"
                  className="inline-flex h-5 w-5 items-center justify-center text-muted-foreground/70"
                >
                  <Save className="size-3.5" />
                </span>
              </Tooltip>
            </span>
          ) : (
            <button
              type="button"
              aria-label={messages.workflow.focus.save}
              onClick={() => onRequestSave?.()}
              className={`inline-flex items-center gap-1.5 rounded border border-border px-2 py-0.5 hover:bg-accent ${compactFocusRing}`}
            >
              <Save className="size-3.5" />
              {messages.workflow.focus.save}
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
            onExecuted={(executed: Step) => {
              workflowStore.commitExecutedStep(executed);
              // Credit the origin saved request with one execution. CallPanel fires
              // onExecuted only when the call reached the server (shouldRecordExecuted),
              // so this counts "any server response". Routed through the catalog so the
              // in-memory tree stays in sync — otherwise a later whole-collection autosave
              // would upsert the stale (pre-bump) count back over it. Best-effort.
              if (origin) {
                void bumpUsage(origin.collectionId, origin.requestId, Date.now()).catch(() => {});
              }
            }}
            editable
            // Quick-add «+» saves into the open request's collection (origin). An unbound
            // draft has no target collection, so the «+» is hidden rather than silently
            // landing the method in some arbitrary collection.
            onQuickAddMethod={origin ? onQuickAddMethod : undefined}
            originAuth={originAuth}
            originVars={originVars}
          />
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            {messages.workflow.focus.noActiveRequest}
          </div>
        )}
      </div>
    </div>
  );
}
