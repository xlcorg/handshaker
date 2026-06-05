import type { ItemIpc, SavedRequestIpc } from "@/ipc/bindings";
import type { Step } from "@/features/workflow/model";
import type { DraftOrigin } from "@/features/workflow/store";
import { newId } from "@/lib/ids";
import { stepToSavedRequest } from "./mapping";

/** Persist an unbound draft as a NEW saved request. Returns the new request id so the
 *  caller can bind the draft origin. `addItem` is `useCatalogTree.addItem`. */
export async function saveNewRequest(
  addItem: (collectionId: string, parentId: string | null, item: ItemIpc) => Promise<void>,
  draft: Step,
  dest: { collectionId: string; parentId: string | null; name: string },
): Promise<string> {
  const id = newId();
  const saved = stepToSavedRequest(draft, { id, name: dest.name });
  await addItem(dest.collectionId, dest.parentId, { type: "request", ...saved });
  return id;
}

/** Persist edits to an origin-bound draft. `updateItemContent` preserves id/name/usage, so
 *  the `name` passed here is irrelevant (placeholder). `updateItemContent` is the hook method. */
export async function autosaveDraft(
  updateItemContent: (collectionId: string, itemId: string, content: SavedRequestIpc) => Promise<void>,
  origin: DraftOrigin,
  draft: Step,
): Promise<void> {
  const content = stepToSavedRequest(draft, { id: origin.requestId, name: "" });
  await updateItemContent(origin.collectionId, origin.requestId, content);
}
