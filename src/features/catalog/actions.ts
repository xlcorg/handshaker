import type { SavedRequestIpc } from "@/ipc/bindings";
import { workflowStore } from "@/features/workflow/store";
import { setView } from "@/features/workflow/reducers";
import { newStep } from "@/features/workflow/model";
import { lastExecutedFor, responseSeedPatch } from "@/features/workflow/lastExecuted";
import { savedRequestToDraft } from "./mapping";

/** Open a saved request in Focus as the global pending-draft, bound to its origin.
 *  The Response panel is seeded with THIS session's last executed call of the same
 *  service/method/address (from the workflow history). */
export function openSavedRequest(collectionId: string, saved: SavedRequestIpc): void {
  workflowStore.update((w) => setView(w, "focus"));
  const draft = savedRequestToDraft(saved);
  const last = lastExecutedFor(workflowStore.activeWorkflow().steps, {
    service: draft.service,
    method: draft.method,
    address: draft.address,
  });
  workflowStore.setDraft(
    { ...draft, ...responseSeedPatch(last) },
    { collectionId, requestId: saved.id, requestName: saved.name },
  );
}

/** Start a fresh, empty pending-draft in Focus (header `+` / menu "Add request"). */
export function newRequestDraft(): void {
  workflowStore.update((w) => setView(w, "focus"));
  workflowStore.setDraft(newStep({ address: "", tls: false, service: "", method: "" }));
}
