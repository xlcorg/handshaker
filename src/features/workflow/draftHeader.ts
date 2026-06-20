import { shortService } from "@/features/shell/SelectedMethod";
import { pathNamesToItem } from "@/features/catalog/treeNav";
import type { CollectionIpc } from "@/ipc/bindings";
import type { Step } from "./model";
import type { DraftOrigin } from "./store";
import { messages } from "@/lib/messages";

/** Breadcrumb segments for the draft header.
 *  - Unbound → ["Новый реквест"].
 *  - Bound → full live path from the catalog `[collection, …folders, request]`.
 *  - Fallback (just-saved before reload, or deleted) → stored origin names, else the call label.
 *  Returned as segments so the caller can keep the last (request-name) segment from truncating. */
export function draftBreadcrumb(
  draft: Step,
  origin: DraftOrigin | null,
  collections: CollectionIpc[] = [],
): string[] {
  if (!origin) return [messages.workflow.draft.newRequest];

  const path = pathNamesToItem(collections, origin.requestId);
  if (path) return path;

  if (origin.requestName) {
    return origin.collectionName
      ? [origin.collectionName, origin.requestName]
      : [origin.requestName];
  }

  const svc = shortService(draft.service);
  return [draft.method ? `${svc} / ${draft.method}` : svc || messages.workflow.draft.savedRequestFallback];
}
