import type { ItemIpc, RequestTemplateIpc } from "@/ipc/bindings";
import type { Draft } from "@/features/workflow/model";
import type { DraftOrigin } from "@/features/workflow/store";
import { newId } from "@/lib/ids";
import { templateOf } from "./mapping";

/** Persist an unbound draft as a NEW saved request. Returns the new request id so the
 *  caller can bind the draft origin. `addItem` is `useCatalogTree.addItem`. */
export async function saveNewRequest(
  addItem: (collectionId: string, parentId: string | null, item: ItemIpc) => Promise<void>,
  draft: Draft,
  dest: { collectionId: string; parentId: string | null; name: string },
): Promise<string> {
  const id = newId();
  await addItem(dest.collectionId, dest.parentId, {
    type: "request",
    id,
    name: dest.name,
    last_used_at: null,
    use_count: 0,
    template: templateOf(draft),
  });
  return id;
}

/** Persist edits to an origin-bound draft. Writes only the template, so id, name and
 *  usage stay as stored. `updateItemContent` is the hook method. */
export async function autosaveDraft(
  updateItemContent: (collectionId: string, itemId: string, content: RequestTemplateIpc) => Promise<void>,
  origin: DraftOrigin,
  draft: Draft,
): Promise<void> {
  await updateItemContent(origin.collectionId, origin.requestId, templateOf(draft));
}
