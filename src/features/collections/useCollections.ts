import { useCallback, useEffect, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { ipc } from "@/ipc/client";
import { newId } from "@/lib/ids";
import type { CollectionIpc, CollectionMetaIpc, ItemIpc } from "@/ipc/bindings";

export interface UseCollections {
  metas: CollectionMetaIpc[];
  byId: Record<string, CollectionIpc>;
  loading: boolean;
  error: string | null;
  refreshList: () => Promise<void>;
  load: (id: string) => Promise<CollectionIpc>;
  createCollection: (name: string) => Promise<string>;
  addRequest: (collectionId: string, parentId: string | null, item: ItemIpc) => Promise<void>;
  upsert: (collection: CollectionIpc) => Promise<void>;
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

  useEffect(() => {
    if (!isTauri()) return;
    refreshList().catch(() => undefined);
  }, [refreshList]);

  return { metas, byId, loading, error, refreshList, load, createCollection, addRequest, upsert };
}
