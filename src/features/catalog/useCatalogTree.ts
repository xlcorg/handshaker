import { useCallback, useEffect, useRef, useState } from "react";
import { ipc } from "@/ipc/client";
import type { CollectionIpc, ItemIpc, SavedRequestIpc } from "@/ipc/bindings";
import { newId } from "@/lib/ids";
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
} from "./treeEdit";

export interface UseCatalogTree {
  tree: CollectionIpc[];
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
  createCollection: (name: string) => Promise<string>;
  deleteCollection: (collectionId: string) => Promise<void>;
  renameCollection: (collectionId: string, name: string) => Promise<void>;
  setPinned: (collectionId: string, pinned: boolean) => Promise<void>;
  addItem: (collectionId: string, parentId: string | null, item: ItemIpc) => Promise<void>;
  renameItem: (collectionId: string, itemId: string, name: string) => Promise<void>;
  updateItemContent: (collectionId: string, itemId: string, content: SavedRequestIpc) => Promise<void>;
  deleteItem: (collectionId: string, itemId: string) => Promise<void>;
  duplicateItem: (collectionId: string, itemId: string) => Promise<void>;
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
  };
}

function errMsg(e: unknown): string {
  const t = e as { message?: string; type?: string };
  return t?.message ?? t?.type ?? "operation failed";
}

export function useCatalogTree(): UseCatalogTree {
  const [tree, setTree] = useState<CollectionIpc[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const treeRef = useRef<CollectionIpc[]>([]);

  const apply = useCallback((t: CollectionIpc[]) => {
    treeRef.current = t;
    setTree(t);
  }, []);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
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
      setError(errMsg(e));
    } finally {
      setLoading(false);
    }
  }, [apply]);

  useEffect(() => {
    void reload();
  }, [reload]);

  /** Apply a local transform, run the IPC call, and roll back on rejection. */
  const optimistic = useCallback(
    async (next: (prev: CollectionIpc[]) => CollectionIpc[], call: () => Promise<unknown>) => {
      const snapshot = treeRef.current;
      apply(next(snapshot));
      try {
        await call();
      } catch (e) {
        apply(snapshot);
        setError(errMsg(e));
        throw e;
      }
    },
    [apply],
  );

  const createCollection = useCallback(
    async (name: string) => {
      const c = emptyCollection(name);
      await optimistic((prev) => [...prev, c], () => ipc.collectionUpsert(c));
      return c.id;
    },
    [optimistic],
  );

  const deleteCollection = useCallback(
    (collectionId: string) =>
      optimistic(
        (prev) => removeCollectionFromTree(prev, collectionId),
        () => ipc.collectionDelete(collectionId),
      ),
    [optimistic],
  );

  const renameCollection = useCallback(
    (collectionId: string, name: string) =>
      optimistic(
        (prev) => renameCollectionInTree(prev, collectionId, name),
        () => ipc.collectionUpsert(treeRef.current.find((c) => c.id === collectionId)!),
      ),
    [optimistic],
  );

  const setPinned = useCallback(
    (collectionId: string, pinned: boolean) =>
      optimistic(
        (prev) => setCollectionPinned(prev, collectionId, pinned),
        () => ipc.collectionUpsert(treeRef.current.find((c) => c.id === collectionId)!),
      ),
    [optimistic],
  );

  const addItem = useCallback(
    (collectionId: string, parentId: string | null, item: ItemIpc) =>
      optimistic(
        (prev) => insertItemInTree(prev, collectionId, parentId, item),
        () => ipc.collectionAddItem(collectionId, parentId, item),
      ),
    [optimistic],
  );

  const renameItem = useCallback(
    (collectionId: string, itemId: string, name: string) =>
      optimistic(
        (prev) => renameItemInTree(prev, collectionId, itemId, name),
        () => ipc.collectionRenameItem(collectionId, itemId, name),
      ),
    [optimistic],
  );

  const updateItemContent = useCallback(
    (collectionId: string, itemId: string, content: SavedRequestIpc) =>
      optimistic(
        (prev) => replaceItemInTree(prev, collectionId, itemId, content),
        () => ipc.collectionUpsert(treeRef.current.find((c) => c.id === collectionId)!),
      ),
    [optimistic],
  );

  const deleteItem = useCallback(
    (collectionId: string, itemId: string) =>
      optimistic(
        (prev) => removeItemFromTree(prev, collectionId, itemId),
        () => ipc.collectionDeleteItem(collectionId, itemId),
      ),
    [optimistic],
  );

  // Backend assigns the new id and deep-copies; reload the affected collection.
  const duplicateItem = useCallback(
    async (collectionId: string, itemId: string) => {
      try {
        await ipc.collectionDuplicateItem(collectionId, itemId);
        const fresh = await ipc.collectionGet(collectionId);
        apply(treeRef.current.map((c) => (c.id === collectionId ? fresh : c)));
      } catch (e) {
        setError(errMsg(e));
        throw e;
      }
    },
    [apply],
  );

  const moveItem = useCallback(
    (collectionId: string, itemId: string, parentId: string | null, position: number) =>
      optimistic(
        (prev) => moveItemWithinTree(prev, collectionId, itemId, parentId, position),
        () => ipc.collectionMoveItem(collectionId, itemId, parentId, position),
      ),
    [optimistic],
  );

  const moveItemAcross = useCallback(
    (
      sourceCollectionId: string,
      itemId: string,
      targetCollectionId: string,
      parentId: string | null,
      position: number,
    ) =>
      optimistic(
        (prev) => moveItemAcrossTree(prev, sourceCollectionId, itemId, targetCollectionId, parentId, position),
        () => ipc.collectionMoveItemAcross(sourceCollectionId, itemId, targetCollectionId, parentId, position),
      ),
    [optimistic],
  );

  return {
    tree,
    loading,
    error,
    reload,
    createCollection,
    deleteCollection,
    renameCollection,
    setPinned,
    addItem,
    renameItem,
    updateItemContent,
    deleteItem,
    duplicateItem,
    moveItem,
    moveItemAcross,
  };
}
