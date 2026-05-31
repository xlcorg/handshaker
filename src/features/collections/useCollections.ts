import { useCallback, useEffect, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { ipc } from "@/ipc/client";
import { newId } from "@/lib/ids";
import type { CollectionIpc, CollectionMetaIpc, ItemIpc } from "@/ipc/bindings";
import { SAMPLE_COLLECTIONS } from "./fixtures";

export interface UseCollections {
  metas: CollectionMetaIpc[];
  byId: Record<string, CollectionIpc>;
  tree: CollectionIpc[];
  loading: boolean;
  error: string | null;
  refreshList: () => Promise<void>;
  loadAll: () => Promise<void>;
  load: (id: string) => Promise<CollectionIpc>;
  createCollection: (name: string) => Promise<string>;
  addRequest: (collectionId: string, parentId: string | null, item: ItemIpc) => Promise<void>;
  upsert: (collection: CollectionIpc) => Promise<void>;
  renameItem: (collectionId: string, itemId: string, name: string) => Promise<void>;
  deleteItem: (collectionId: string, itemId: string) => Promise<void>;
  duplicateItem: (collectionId: string, itemId: string) => Promise<void>;
}

function tag(e: unknown): string {
  const t = e as { type?: string; message?: string };
  return t.message ?? t.type ?? "collection error";
}

export function useCollections(): UseCollections {
  const [metas, setMetas] = useState<CollectionMetaIpc[]>([]);
  const [byId, setById] = useState<Record<string, CollectionIpc>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Derive tree: ordered by metas, resolved from byId
  const tree = metas.map((m) => byId[m.id]).filter((c): c is CollectionIpc => c !== undefined);

  const refreshList = useCallback(async () => {
    setLoading(true);
    try {
      setMetas(await ipc.collectionList());
      setError(null);
    } catch (e) {
      setError(tag(e));
    } finally {
      setLoading(false);
    }
  }, []);

  const load = useCallback(async (id: string) => {
    const c = await ipc.collectionGet(id);
    setById((m) => ({ ...m, [id]: c }));
    return c;
  }, []);

  const loadAll = useCallback(async () => {
    if (!isTauri()) {
      // Populate from in-memory fixtures for browser dev
      const fixtureMetas: CollectionMetaIpc[] = SAMPLE_COLLECTIONS.map((c) => ({
        id: c.id,
        name: c.name,
      }));
      const fixtureById: Record<string, CollectionIpc> = {};
      for (const c of SAMPLE_COLLECTIONS) {
        fixtureById[c.id] = c;
      }
      setMetas(fixtureMetas);
      setById(fixtureById);
      return;
    }

    setLoading(true);
    try {
      const list = await ipc.collectionList();
      setMetas(list);
      const collections = await Promise.all(list.map((m) => ipc.collectionGet(m.id)));
      setById((prev) => {
        const next = { ...prev };
        for (const c of collections) {
          next[c.id] = c;
        }
        return next;
      });
      setError(null);
    } catch (e) {
      setError(tag(e));
    } finally {
      setLoading(false);
    }
  }, []);

  const createCollection = useCallback(
    async (name: string) => {
      const id = newId();
      const collection: CollectionIpc = {
        id,
        name,
        items: [],
        variables: {},
        auth_by_env: { configs: {} },
        default_tls: false,
        skip_tls_verify: false,
      };
      await ipc.collectionUpsert(collection);
      setById((m) => ({ ...m, [id]: collection }));
      await refreshList();
      return id;
    },
    [refreshList],
  );

  const addRequest = useCallback(
    async (collectionId: string, parentId: string | null, item: ItemIpc) => {
      await ipc.collectionAddItem(collectionId, parentId, item);
      await load(collectionId);
    },
    [load],
  );

  const upsert = useCallback(
    async (collection: CollectionIpc) => {
      await ipc.collectionUpsert(collection);
      setById((m) => ({ ...m, [collection.id]: collection }));
      await refreshList();
    },
    [refreshList],
  );

  const renameItem = useCallback(
    async (collectionId: string, itemId: string, name: string) => {
      await ipc.collectionRenameItem(collectionId, itemId, name);
      await load(collectionId);
    },
    [load],
  );

  const deleteItem = useCallback(
    async (collectionId: string, itemId: string) => {
      // IPC returns an undo snapshot; ignored for now
      await ipc.collectionDeleteItem(collectionId, itemId);
      await load(collectionId);
    },
    [load],
  );

  const duplicateItem = useCallback(
    async (collectionId: string, itemId: string) => {
      await ipc.collectionDuplicateItem(collectionId, itemId);
      await load(collectionId);
    },
    [load],
  );

  useEffect(() => {
    loadAll().catch(() => undefined);
  }, [loadAll]);

  return {
    metas,
    byId,
    tree,
    loading,
    error,
    refreshList,
    loadAll,
    load,
    createCollection,
    addRequest,
    upsert,
    renameItem,
    deleteItem,
    duplicateItem,
  };
}
