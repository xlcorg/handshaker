import { toast } from "sonner";
import type { CollectionIpc } from "@/ipc/bindings";
import { workflowStore } from "@/features/workflow/store";
import { runCall, runHttpCall, type BumpUsage } from "@/features/workflow/callLifecycle";
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
    workflowStore.setDraft(plan.draft, origin);
    if (origin) void patchUiState({ active_request: { collection_id: origin.collectionId, item_id: origin.requestId } });
    if (plan.kind === "unbound" && plan.originMissing) toast.info(messages.history.notice.originMissing);
    if (intent !== "rerun") return;
    const draft = plan.draft;
    const envName = workflowStore.activeWorkflow().envName;
    const recording = { origin, bumpUsage: deps.bumpUsage };
    if (draft.protocol === "http") {
      void runHttpCall({ draft, envName, onRun: (run) => workflowStore.setHttpRun(draft.id, run), recording });
      return;
    }
    void runCall({
      step: draft,
      envName,
      kind: recordKind(record),
      onPatch: (p) => workflowStore.updateGrpcDraft(draft.id, p),
      recording,
    });
  });
}
