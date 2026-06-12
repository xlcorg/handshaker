import { useCallback, useEffect, useRef, useState } from "react";
import { ipc } from "@/ipc/client";
import type { CollectionIpc, ItemIpc, SavedRequestIpc } from "@/ipc/bindings";
import { newId } from "@/lib/ids";
import { toast } from "sonner";
import {
  insertItemInTree,
  moveItemAcrossTree,
  moveItemWithinTree,
  removeCollectionFromTree,
  removeItemFromTree,
  renameCollectionInTree,
  renameItemInTree,
  replaceItemInTree,
  setCollectionPinned,
  setNodeExpanded,
} from "./treeEdit";

export interface UseCatalogTree {
  tree: CollectionIpc[];
  loading: boolean;
  reload: () => Promise<void>;
  createCollection: (name: string) => Promise<string>;
  deleteCollection: (collectionId: string) => Promise<void>;
  renameCollection: (collectionId: string, name: string) => Promise<void>;
  setPinned: (collectionId: string, pinned: boolean) => Promise<void>;
  setExpanded: (collectionId: string, itemId: string | null, expanded: boolean) => Promise<void>;
  addItem: (collectionId: string, parentId: string | null, item: ItemIpc) => Promise<void>;
  renameItem: (collectionId: string, itemId: string, name: string) => Promise<void>;
  updateItemContent: (collectionId: string, itemId: string, content: SavedRequestIpc) => Promise<void>;
  deleteItem: (collectionId: string, itemId: string) => Promise<void>;
  duplicateItem: (collectionId: string, itemId: string) => Promise<ItemIpc | null>;
  moveItem: (collectionId: string, itemId: string, parentId: string | null, position: number) => Promise<void>;
  moveItemAcross: (
    sourceCollectionId: string,
    itemId: string,
    targetCollectionId: string,
    parentId: string | null,
    position: number,
  ) => Promise<void>;
}

function emptyCollection(name: string): CollectionIpc {
  return {
    id: newId(),
    name,
    items: [],
    variables: {},
    auth: { kind: "none" },
    default_tls: false,
    skip_tls_verify: false,
    pinned: false,
    description: null,
    created_at: Date.now(),
    expanded: false,
  };
}

function errMsg(e: unknown): string {
  const t = e as { message?: string; type?: string };
  return t?.message ?? t?.type ?? "operation failed";
}

/** Depth-first lookup of an item by id within a collection's tree (folders nest). */
function findItemById(items: ItemIpc[], itemId: string): ItemIpc | undefined {
  for (const it of items) {
    if (it.id === itemId) return it;
    if (it.type === "folder") {
      const found = findItemById(it.items, itemId);
      if (found) return found;
    }
  }
  return undefined;
}

/** Display name of an item in a collection, for toast messages (falls back to "item"). */
function itemNameOf(tree: CollectionIpc[], collectionId: string, itemId: string): string {
  const items = tree.find((c) => c.id === collectionId)?.items ?? [];
  return findItemById(items, itemId)?.name ?? "item";
}

/** Display name of a collection, for toast messages (falls back to "collection"). */
function collectionNameOf(tree: CollectionIpc[], collectionId: string): string {
  return tree.find((c) => c.id === collectionId)?.name ?? "collection";
}

export function useCatalogTree(): UseCatalogTree {
  const [tree, setTree] = useState<CollectionIpc[]>([]);
  const [loading, setLoading] = useState(true);
  const treeRef = useRef<CollectionIpc[]>([]);

  const apply = useCallback((t: CollectionIpc[]) => {
    treeRef.current = t;
    setTree(t);
  }, []);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const metas = await ipc.collectionList();
      if (metas.length === 0) {
        const def = emptyCollection("My Collection");
        await ipc.collectionUpsert(def);
        apply([def]);
      } else {
        const cols = await Promise.all(metas.map((m) => ipc.collectionGet(m.id)));
        apply(cols);
      }
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setLoading(false);
    }
  }, [apply]);

  useEffect(() => {
    void reload();
  }, [reload]);

  /** Apply a local transform, run the IPC call, toast the result, roll back on rejection. */
  const optimistic = useCallback(
    async (
      next: (prev: CollectionIpc[]) => CollectionIpc[],
      call: () => Promise<unknown>,
      labels: { ok?: string; err: string },
    ) => {
      const snapshot = treeRef.current;
      apply(next(snapshot));
      try {
        await call();
        if (labels.ok) toast.success(labels.ok);
      } catch (e) {
        apply(snapshot);
        toast.error(labels.err);
        throw e;
      }
    },
    [apply],
  );

  const createCollection = useCallback(
    async (name: string) => {
      const c = emptyCollection(name);
      await optimistic((prev) => [...prev, c], () => ipc.collectionUpsert(c), {
        err: `Couldn't create "${name}"`,
      });
      return c.id;
    },
    [optimistic],
  );

  const deleteCollection = useCallback(
    (collectionId: string) => {
      const name = collectionNameOf(treeRef.current, collectionId);
      return optimistic(
        (prev) => removeCollectionFromTree(prev, collectionId),
        () => ipc.collectionDelete(collectionId),
        { ok: `Deleted "${name}"`, err: `Couldn't delete "${name}"` },
      );
    },
    [optimistic],
  );

  const renameCollection = useCallback(
    (collectionId: string, name: string) => {
      const prevName = collectionNameOf(treeRef.current, collectionId);
      return optimistic(
        (prev) => renameCollectionInTree(prev, collectionId, name),
        () => ipc.collectionUpsert(treeRef.current.find((c) => c.id === collectionId)!),
        { ok: `Renamed to "${name}"`, err: `Couldn't rename "${prevName}"` },
      );
    },
    [optimistic],
  );

  const setPinned = useCallback(
    (collectionId: string, pinned: boolean) => {
      const name = collectionNameOf(treeRef.current, collectionId);
      return optimistic(
        (prev) => setCollectionPinned(prev, collectionId, pinned),
        () => ipc.collectionUpsert(treeRef.current.find((c) => c.id === collectionId)!),
        { ok: pinned ? `Pinned "${name}"` : `Unpinned "${name}"`, err: `Couldn't update pin for "${name}"` },
      );
    },
    [optimistic],
  );

  const setExpanded = useCallback(
    (collectionId: string, itemId: string | null, expanded: boolean) =>
      optimistic(
        (prev) => setNodeExpanded(prev, collectionId, itemId, expanded),
        () => ipc.collectionSetExpanded(collectionId, itemId, expanded),
        // Expansion is silent on success; only surface a failure.
        { err: "Couldn't save expansion" },
      ),
    [optimistic],
  );

  const addItem = useCallback(
    (collectionId: string, parentId: string | null, item: ItemIpc) =>
      optimistic(
        (prev) => insertItemInTree(prev, collectionId, parentId, item),
        () => ipc.collectionAddItem(collectionId, parentId, item),
        // Adds are silent on success; only report failure.
        { err: `Couldn't add ${item.type}` },
      ),
    [optimistic],
  );

  const renameItem = useCallback(
    (collectionId: string, itemId: string, name: string) => {
      const prevName = itemNameOf(treeRef.current, collectionId, itemId);
      return optimistic(
        (prev) => renameItemInTree(prev, collectionId, itemId, name),
        () => ipc.collectionRenameItem(collectionId, itemId, name),
        { ok: `Renamed to "${name}"`, err: `Couldn't rename "${prevName}"` },
      );
    },
    [optimistic],
  );

  const updateItemContent = useCallback(
    (collectionId: string, itemId: string, content: SavedRequestIpc) =>
      optimistic(
        (prev) => replaceItemInTree(prev, collectionId, itemId, content),
        () => ipc.collectionUpsert(treeRef.current.find((c) => c.id === collectionId)!),
        // Saves are silent on success; only report failure.
        { err: "Couldn't save request" },
      ),
    [optimistic],
  );

  const deleteItem = useCallback(
    (collectionId: string, itemId: string) => {
      const name = itemNameOf(treeRef.current, collectionId, itemId);
      return optimistic(
        (prev) => removeItemFromTree(prev, collectionId, itemId),
        () => ipc.collectionDeleteItem(collectionId, itemId),
        { ok: `Deleted "${name}"`, err: `Couldn't delete "${name}"` },
      );
    },
    [optimistic],
  );

  // Backend assigns the new id and deep-copies; reload the affected collection
  // and hand the caller the duplicated item (null if not found — race, or a folder
  // the caller doesn't care about).
  const duplicateItem = useCallback(
    async (collectionId: string, itemId: string): Promise<ItemIpc | null> => {
      const name = itemNameOf(treeRef.current, collectionId, itemId);
      try {
        const newItemId = await ipc.collectionDuplicateItem(collectionId, itemId);
        const fresh = await ipc.collectionGet(collectionId);
        apply(treeRef.current.map((c) => (c.id === collectionId ? fresh : c)));
        // Duplicates are silent on success; only report failure.
        return findItemById(fresh.items, newItemId) ?? null;
      } catch (e) {
        toast.error(`Couldn't duplicate "${name}"`);
        throw e;
      }
    },
    [apply],
  );

  const moveItem = useCallback(
    (collectionId: string, itemId: string, parentId: string | null, position: number) => {
      const name = itemNameOf(treeRef.current, collectionId, itemId);
      return optimistic(
        (prev) => moveItemWithinTree(prev, collectionId, itemId, parentId, position),
        () => ipc.collectionMoveItem(collectionId, itemId, parentId, position),
        { ok: `Moved "${name}"`, err: `Couldn't move "${name}"` },
      );
    },
    [optimistic],
  );

  const moveItemAcross = useCallback(
    (
      sourceCollectionId: string,
      itemId: string,
      targetCollectionId: string,
      parentId: string | null,
      position: number,
    ) => {
      const name = itemNameOf(treeRef.current, sourceCollectionId, itemId);
      return optimistic(
        (prev) => moveItemAcrossTree(prev, sourceCollectionId, itemId, targetCollectionId, parentId, position),
        () => ipc.collectionMoveItemAcross(sourceCollectionId, itemId, targetCollectionId, parentId, position),
        { ok: `Moved "${name}"`, err: `Couldn't move "${name}"` },
      );
    },
    [optimistic],
  );

  return {
    tree,
    loading,
    reload,
    createCollection,
    deleteCollection,
    renameCollection,
    setPinned,
    setExpanded,
    addItem,
    renameItem,
    updateItemContent,
    deleteItem,
    duplicateItem,
    moveItem,
    moveItemAcross,
  };
}
