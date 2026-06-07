import { ipc } from "@/ipc/client";
import type { UiStateIpc } from "@/ipc/bindings";

/**
 * Shared read-modify-write cache for the global UI state (sort key + active request).
 *
 * `ipc.appSettingsSet` REPLACES the entire persisted `UiStateIpc` — it is not a merge.
 * Multiple components persist different fields (SidebarShell → sort_key,
 * WorkflowApp → active_request); funnelling every write through this single cache lets
 * `patchUiState` send the full merged object so the writers never clobber each other.
 */
let cache: UiStateIpc = { sort_key: null, active_request: null };

/** Load the persisted UI state from the backend and seed the cache. */
export async function loadUiState(): Promise<UiStateIpc> {
  cache = await ipc.appSettingsGet();
  return cache;
}

/** The last-known UI state (cache). Synchronous; call `loadUiState` first to populate. */
export function readUiState(): UiStateIpc {
  return cache;
}

/** Merge `patch` into the cache and persist the FULL merged object (no clobber). */
export async function patchUiState(patch: Partial<UiStateIpc>): Promise<void> {
  cache = { ...cache, ...patch };
  await ipc.appSettingsSet(cache);
}

/** Test-only: reset the module-level cache between tests. */
export function resetUiState(): void {
  cache = { sort_key: null, active_request: null };
}
