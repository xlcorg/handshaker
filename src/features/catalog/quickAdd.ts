import type { CollectionIpc } from "@/ipc/bindings";
import { findSavedLocations, suggestSaveTarget, type SaveLocation } from "./grouping";

export type QuickAddPlan =
  | { kind: "exists"; location: SaveLocation }
  | {
      kind: "create";
      /** null → no collections at all; the executor creates one named `collectionName`. */
      collectionId: string | null;
      collectionName: string;
      /** Existing root folder named after the service; null → create `folderName`. */
      folderId: string | null;
      folderName: string;
      requestName: string;
    };

/** Where the quick «+» puts a method: dedupe by service+method+address, otherwise
 *  the collection the user is working in (`preferredCollectionId`, the open request's
 *  origin) + a root folder named after the service (suggestSaveTarget). Falls back to
 *  the first collection when there is no origin (a brand-new unbound draft) or the
 *  preferred id no longer exists. */
export function planQuickAdd(
  tree: CollectionIpc[],
  service: string,
  method: string,
  address: string,
  preferredCollectionId?: string | null,
): QuickAddPlan {
  const existing = findSavedLocations(tree, { service, method, address });
  if (existing.length > 0) return { kind: "exists", location: existing[0] };

  const reco = suggestSaveTarget(service, method);
  const preferred =
    preferredCollectionId != null ? tree.find((c) => c.id === preferredCollectionId) : undefined;
  const col = preferred ?? tree[0] ?? null;
  const folderHit = col?.items.find((it) => it.type === "folder" && it.name === reco.folderName);
  return {
    kind: "create",
    collectionId: col?.id ?? null,
    collectionName: col?.name ?? "My Collection",
    folderId: folderHit?.id ?? null,
    folderName: reco.folderName,
    requestName: reco.requestName,
  };
}
