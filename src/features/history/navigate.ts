import { toast } from "sonner";
import type { CollectionIpc } from "@/ipc/bindings";
import { workflowStore } from "@/features/workflow/store";
import { setView } from "@/features/workflow/reducers";
import { runCall, type BumpUsage } from "@/features/workflow/callLifecycle";
import { patchUiState } from "@/features/catalog/uiState";
import { messages } from "@/lib/messages";
import { planHistoryOpen, recordKind } from "./model";
import { historyStore } from "./store";

export type HistoryIntent = "open" | "rerun";

export interface HistoryNavDeps {
  /** The catalog tree when the guarded action runs. A Save in the discard dialog reloads
   *  the catalog before the action, and the plan has to see that tree. */
  tree: () => readonly CollectionIpc[];
  /** WorkflowApp's `guardedRun`: a dirty unbound draft defers the action to the discard
   *  dialog, and Cancel drops it. */
  guard: (action: () => void) => void;
  /** Close an open collection overview so Focus is visible. */
  revealFocus: () => void;
  bumpUsage: BumpUsage;
}

/** Open a recorded call in Focus, or open it and send it once (`rerun`). Opening never
 *  sends. The new execution is a new record. */
export async function openHistoryCall(id: string, intent: HistoryIntent, deps: HistoryNavDeps): Promise<void> {
  const record = await historyStore.load(id);
  if (!record) {
    toast.error(messages.history.toast.unavailable);
    return;
  }
  deps.guard(() => {
    const plan = planHistoryOpen(record, deps.tree());
    const origin = plan.kind === "bound" ? plan.origin : null;
    deps.revealFocus();
    workflowStore.update((w) => setView(w, "focus"));
    workflowStore.setDraft(plan.draft, origin);
    if (origin) void patchUiState({ active_request: { collection_id: origin.collectionId, item_id: origin.requestId } });
    if (plan.kind === "unbound" && plan.originMissing) toast.info(messages.history.notice.originMissing);
    if (intent !== "rerun") return;
    void runCall({
      step: plan.draft,
      envName: workflowStore.activeWorkflow().envName,
      kind: recordKind(record),
      onPatch: (p) => workflowStore.updateDraft(plan.draft.id, p),
      recording: { origin, bumpUsage: deps.bumpUsage },
    });
  });
}
