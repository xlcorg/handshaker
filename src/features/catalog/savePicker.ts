import type { CollectionIpc } from "@/ipc/bindings";
import { insertItemInTree } from "./treeEdit";

/** A collection the user added in the Save dialog but hasn't persisted yet. */
export interface PendingCollection {
  tempId: string;
  name: string;
}

/** A folder the user added in the Save dialog but hasn't persisted yet.
 *  `collectionId`/`parentId` may reference a pending node's tempId. */
export interface PendingFolder {
  tempId: string;
  collectionId: string;
  parentId: string | null;
  name: string;
}

function emptyCollection(id: string, name: string): CollectionIpc {
  return {
    id,
    name,
    items: [],
    variables: {},
    auth: { kind: "none" },
    default_tls: false,
    skip_tls_verify: false,
    pinned: false,
    description: null,
    created_at: 0,
  };
}

/**
 * Splice pending collections/folders into a copy of the real tree so the picker
 * renders them as ordinary nodes. Pending folders are applied in array order, so a
 * parent folder must appear before its children (the dialog appends in that order).
 */
export function augmentTree(
  collections: CollectionIpc[],
  pendingCollections: PendingCollection[],
  pendingFolders: PendingFolder[],
): CollectionIpc[] {
  let tree: CollectionIpc[] = [
    ...collections,
    ...pendingCollections.map((p) => emptyCollection(p.tempId, p.name)),
  ];
  for (const pf of pendingFolders) {
    tree = insertItemInTree(tree, pf.collectionId, pf.parentId, {
      type: "folder",
      id: pf.tempId,
      name: pf.name,
      items: [],
    });
  }
  return tree;
}
