import { useCallback, useEffect, useRef, useState } from "react";
import { ipc } from "@/ipc/client";
import type { CollectionIpc, ItemIpc, SavedRequestIpc } from "@/ipc/bindings";
import { newId } from "@/lib/ids";
import { toast } from "@/lib/toast";
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
      toast(errMsg(e), "error");
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
        if (labels.ok) toast(labels.ok, "success");
      } catch (e) {
        apply(snapshot);
        toast(labels.err, "error");
        throw e;
      }
    },
    [apply],
  );

  const createCollection = useCallback(
    async (name: string) => {
      const c = emptyCollection(name);
      await optimistic((prev) => [...prev, c], () => ipc.collectionUpsert(c), {
        err: `Couldn't create ${name} collection`,
      });
      return c.id;
    },
    [optimistic],
  );

  const deleteCollection = useCallback(
    (collectionId: string) => {
      const name = treeRef.current.find((c) => c.id === collectionId)?.name ?? "collection";
      return optimistic(
        (prev) => removeCollectionFromTree(prev, collectionId),
        () => ipc.collectionDelete(collectionId),
        { ok: `${name} collection was deleted`, err: `Couldn't delete ${name} collection` },
      );
    },
    [optimistic],
  );

  const renameCollection = useCallback(
    (collectionId: string, name: string) =>
      optimistic(
        (prev) => renameCollectionInTree(prev, collectionId, name),
        () => ipc.collectionUpsert(treeRef.current.find((c) => c.id === collectionId)!),
        { ok: `${name} collection was renamed`, err: `Couldn't rename ${name} collection` },
      ),
    [optimistic],
  );

  const setPinned = useCallback(
    (collectionId: string, pinned: boolean) => {
      const name = treeRef.current.find((c) => c.id === collectionId)?.name ?? "collection";
      return optimistic(
        (prev) => setCollectionPinned(prev, collectionId, pinned),
        () => ipc.collectionUpsert(treeRef.current.find((c) => c.id === collectionId)!),
        { ok: `${name} ${pinned ? "pinned" : "unpinned"}`, err: `Couldn't update ${name}` },
      );
    },
    [optimistic],
  );

  const addItem = useCallback(
    (collectionId: string, parentId: string | null, item: ItemIpc) =>
      optimistic(
        (prev) => insertItemInTree(prev, collectionId, parentId, item),
        () => ipc.collectionAddItem(collectionId, parentId, item),
        // Adds are silent on success; only report failure.
        { err: `Couldn't add ${item.name} ${item.type}` },
      ),
    [optimistic],
  );

  const renameItem = useCallback(
    (collectionId: string, itemId: string, name: string) => {
      const items = treeRef.current.find((c) => c.id === collectionId)?.items ?? [];
      const kind = findItemById(items, itemId)?.type ?? "request";
      return optimistic(
        (prev) => renameItemInTree(prev, collectionId, itemId, name),
        () => ipc.collectionRenameItem(collectionId, itemId, name),
        { ok: `${name} ${kind} was renamed`, err: `Couldn't rename ${name} ${kind}` },
      );
    },
    [optimistic],
  );

  const updateItemContent = useCallback(
    (collectionId: string, itemId: string, content: SavedRequestIpc) => {
      const items = treeRef.current.find((c) => c.id === collectionId)?.items ?? [];
      const name = findItemById(items, itemId)?.name ?? "request";
      return optimistic(
        (prev) => replaceItemInTree(prev, collectionId, itemId, content),
        () => ipc.collectionUpsert(treeRef.current.find((c) => c.id === collectionId)!),
        // Saves are silent on success; only report failure.
        { err: `Couldn't save ${name} request` },
      );
    },
    [optimistic],
  );

  const deleteItem = useCallback(
    (collectionId: string, itemId: string) => {
      const items = treeRef.current.find((c) => c.id === collectionId)?.items ?? [];
      const item = findItemById(items, itemId);
      const label = item ? `${item.name} ${item.type}` : "item";
      return optimistic(
        (prev) => removeItemFromTree(prev, collectionId, itemId),
        () => ipc.collectionDeleteItem(collectionId, itemId),
        { ok: `${label} was deleted`, err: `Couldn't delete ${label}` },
      );
    },
    [optimistic],
  );

  // Backend assigns the new id and deep-copies; reload the affected collection.
  const duplicateItem = useCallback(
    async (collectionId: string, itemId: string) => {
      const items = treeRef.current.find((c) => c.id === collectionId)?.items ?? [];
      const item = findItemById(items, itemId);
      const label = item ? `${item.name} ${item.type}` : "item";
      try {
        await ipc.collectionDuplicateItem(collectionId, itemId);
        const fresh = await ipc.collectionGet(collectionId);
        apply(treeRef.current.map((c) => (c.id === collectionId ? fresh : c)));
        // Duplicates are silent on success; only report failure.
      } catch (e) {
        toast(`Couldn't duplicate ${label}`, "error");
        throw e;
      }
    },
    [apply],
  );

  const moveItem = useCallback(
    (collectionId: string, itemId: string, parentId: string | null, position: number) => {
      const items = treeRef.current.find((c) => c.id === collectionId)?.items ?? [];
      const name = findItemById(items, itemId)?.name ?? "item";
      return optimistic(
        (prev) => moveItemWithinTree(prev, collectionId, itemId, parentId, position),
        () => ipc.collectionMoveItem(collectionId, itemId, parentId, position),
        { ok: `${name} was moved`, err: `Couldn't move ${name}` },
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
      const items = treeRef.current.find((c) => c.id === sourceCollectionId)?.items ?? [];
      const name = findItemById(items, itemId)?.name ?? "item";
      return optimistic(
        (prev) => moveItemAcrossTree(prev, sourceCollectionId, itemId, targetCollectionId, parentId, position),
        () => ipc.collectionMoveItemAcross(sourceCollectionId, itemId, targetCollectionId, parentId, position),
        { ok: `${name} was moved`, err: `Couldn't move ${name}` },
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
    addItem,
    renameItem,
    updateItemContent,
    deleteItem,
    duplicateItem,
    moveItem,
    moveItemAcross,
  };
}
