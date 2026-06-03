import { useSyncExternalStore } from "react";
import type { ServiceCatalogIpc } from "@/ipc/bindings";
import {
  newCatalogService,
  newCollection,
  type CatalogService,
  type Collection,
} from "./model";

export interface CatalogState {
  collection: Collection;
}

function initialState(): CatalogState {
  return { collection: newCollection() };
}

let state: CatalogState = initialState();
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

function setServices(services: CatalogService[]) {
  state = { collection: { services } };
  emit();
}

function patchService(id: string, fn: (s: CatalogService) => CatalogService) {
  setServices(state.collection.services.map((s) => (s.id === id ? fn(s) : s)));
}

export const catalogStore = {
  getState(): CatalogState {
    return state;
  },
  subscribe(fn: () => void): () => void {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
  reset() {
    state = initialState();
    emit();
  },
  services(): CatalogService[] {
    return state.collection.services;
  },
  getService(id: string): CatalogService | undefined {
    return state.collection.services.find((s) => s.id === id);
  },
  addService(init: Parameters<typeof newCatalogService>[0]): CatalogService {
    const svc = newCatalogService(init);
    setServices([...state.collection.services, svc]);
    return svc;
  },
  removeService(id: string) {
    setServices(state.collection.services.filter((s) => s.id !== id));
  },
  toggleFavorite(id: string) {
    patchService(id, (s) => ({ ...s, favorite: !s.favorite }));
  },
  curateMethod(id: string, service: string, method: string) {
    patchService(id, (s) =>
      s.curated.some((c) => c.service === service && c.method === method)
        ? s
        : { ...s, curated: [...s.curated, { service, method }] },
    );
  },
  uncurateMethod(id: string, service: string, method: string) {
    patchService(id, (s) => ({
      ...s,
      curated: s.curated.filter((c) => !(c.service === service && c.method === method)),
    }));
  },
  setContract(id: string, contract: ServiceCatalogIpc, fetchedAt: number) {
    patchService(id, (s) => ({ ...s, contract, contractFetchedAt: fetchedAt }));
  },
};

export function useCatalog(): CatalogState {
  return useSyncExternalStore(catalogStore.subscribe, catalogStore.getState);
}
