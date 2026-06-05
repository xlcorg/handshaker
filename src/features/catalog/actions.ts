import type { SavedRequestIpc } from "@/ipc/bindings";
import { workflowStore } from "@/features/workflow/store";
import { setView } from "@/features/workflow/reducers";
import { newStep } from "@/features/workflow/model";
import { savedRequestToDraft } from "./mapping";

/** Open a saved request in Focus as the global pending-draft, bound to its origin. */
export function openSavedRequest(collectionId: string, saved: SavedRequestIpc): void {
  workflowStore.update((w) => setView(w, "focus"));
  workflowStore.setDraft(savedRequestToDraft(saved), { collectionId, requestId: saved.id, requestName: saved.name });
}

/** Start a fresh, empty pending-draft in Focus (header `+` / menu "Add request"). */
export function newRequestDraft(): void {
  workflowStore.update((w) => setView(w, "focus"));
  workflowStore.setDraft(newStep({ address: "", tls: false, service: "", method: "" }));
}
