import { useSyncExternalStore } from "react";
import { ipc } from "@/ipc/client";
import type { LinksPlacementIpc, UiStateIpc } from "@/ipc/bindings";

/**
 * Shared read-modify-write cache for the global UI state (sort key + active
 * request + links placement).
 *
 * `ipc.appSettingsSet` REPLACES the entire persisted `UiStateIpc` — it is not a merge.
 * Multiple components persist different fields (SidebarShell → sort_key,
 * WorkflowApp → active_request, Settings → links_placement); funnelling every write
 * through this single cache lets `patchUiState` send the full merged object so the
 * writers never clobber each other.
 *
 * Writes also notify subscribers so reactive readers (e.g. `useLinksPlacement`)
 * re-render open panels the moment the setting changes.
 */
const DEFAULTS: UiStateIpc = { sort_key: null, active_request: null, links_placement: "strip" };
let cache: UiStateIpc = DEFAULTS;

const listeners = new Set<() => void>();
function emit(): void {
  for (const fn of listeners) fn();
}

/** Load the persisted UI state from the backend and seed the cache. */
export async function loadUiState(): Promise<UiStateIpc> {
  cache = await ipc.appSettingsGet();
  emit();
  return cache;
}

/** The last-known UI state (cache). Synchronous; call `loadUiState` first to populate. */
export function readUiState(): UiStateIpc {
  return cache;
}

/** Merge `patch` into the cache and persist the FULL merged object (no clobber). */
export async function patchUiState(patch: Partial<UiStateIpc>): Promise<void> {
  cache = { ...cache, ...patch };
  emit();
  await ipc.appSettingsSet(cache);
}

/** Subscribe to cache changes (load + patch). Returns an unsubscribe fn. */
export function subscribeUiState(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Reactive read of the collection-links placement preference. Re-renders on change.
 *  The field is serde-optional over IPC (older settings files omit it), so absence
 *  reads as the `strip` default. */
export function useLinksPlacement(): LinksPlacementIpc {
  return useSyncExternalStore(subscribeUiState, () => cache.links_placement ?? "strip");
}

/** Test-only: reset the module-level cache between tests. */
export function resetUiState(): void {
  cache = DEFAULTS;
  emit();
}
