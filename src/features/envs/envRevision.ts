import { useSyncExternalStore } from "react";

// A monotonic counter bumped whenever environment CONTENTS change (an env is saved).
//
// Previews that resolve a template against the ACTIVE environment via the backend
// — e.g. the collection-variables editor, which passes `env_vars: null` and lets the
// backend read the active env — have no other signal that the active env's values
// changed. Switching environments changes the env NAME (a separate resolve-key dep),
// but EDITING the active env's variables does not. Folding this revision into such a
// preview's resolveKey makes it re-resolve after an env edit instead of going stale
// until an unrelated re-render. Any future env-mutation path should call
// `bumpEnvRevision()` so dependent previews stay fresh.
let revision = 0;
const listeners = new Set<() => void>();

/** Signal that environment contents changed, so active-env-dependent previews re-resolve. */
export function bumpEnvRevision(): void {
  revision += 1;
  for (const l of listeners) l();
}

/** Subscribe to the env-revision counter (re-renders the caller on every bump). */
export function useEnvRevision(): number {
  return useSyncExternalStore(
    (onChange) => {
      listeners.add(onChange);
      return () => listeners.delete(onChange);
    },
    () => revision,
  );
}
