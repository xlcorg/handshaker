import { useCallback, useEffect, useRef, useState } from "react";
import * as ipc from "@/ipc/client";
import type { ServiceCatalogIpc } from "@/ipc/bindings";
import { resolveAddressSafe } from "./actions";
import { newId } from "@/lib/ids";
import { readPrefs } from "@/lib/use-prefs";
import { isCancelSentinel } from "./netDiagnostics";

const DEBOUNCE_MS = 400;

export interface DraftReflection {
  catalog: ServiceCatalogIpc | null;
  loading: boolean;
  error: string | null;
  refresh: () => void;
  cancel: () => void;
}

function reflectErr(e: unknown): string {
  const t = e as { message?: string };
  return t?.message ?? "No reflection available at this address";
}

/** Reflect a draft's contract: debounced `grpcDescribe` on (address, tls) change, plus a
 *  manual `refresh()` that bypasses the backend cache via `grpcRefreshContract`. Each run
 *  carries a fresh request id and the user's deadline pref (`requestTimeoutMs`), so a slow
 *  or hung reflection times out instead of spinning forever, and `cancel()` can abort the
 *  in-flight run early — both reuse the invoke registry (`grpcCancel` + the backend's
 *  `race_cancel_timeout`). */
export function useDraftReflection(
  address: string,
  tls: boolean,
  enabled = true,
  collectionId: string | null = null,
): DraftReflection {
  const [catalog, setCatalog] = useState<ServiceCatalogIpc | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Request id of the latest in-flight run = the cancel target. Cleared when that run
  // settles, so cancel() after completion is a no-op.
  const inFlight = useRef<string | null>(null);

  const run = useCallback(
    async (force: boolean) => {
      const addr = address.trim();
      if (!enabled || !addr) {
        setCatalog(null);
        setError(null);
        setLoading(false);
        return;
      }
      const requestId = newId();
      inFlight.current = requestId;
      const timeoutMs = readPrefs().requestTimeoutMs;
      setLoading(true);
      setError(null);
      try {
        const resolved = await resolveAddressSafe(addr, collectionId);
        const target = { address: resolved, tls, skip_verify: false };
        const c = force
          ? await ipc.grpcRefreshContract(target, requestId, timeoutMs)
          : await ipc.grpcDescribe(target, requestId, timeoutMs);
        setCatalog(c);
      } catch (e) {
        const message = reflectErr(e);
        // A user cancel is quiet: keep the existing catalog, show no error banner. Any
        // other failure — including the deadline timeout — surfaces with a Retry.
        if (!isCancelSentinel(message)) {
          setCatalog(null);
          setError(message);
        }
      } finally {
        // Only the latest run owns the loading flag — a stale run settling after a newer
        // one started must not clear the spinner out from under it.
        if (inFlight.current === requestId) {
          inFlight.current = null;
          setLoading(false);
        }
      }
    },
    [address, tls, enabled, collectionId],
  );

  useEffect(() => {
    if (!enabled || !address.trim()) return;
    const t = setTimeout(() => void run(false), DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [run, enabled, address]);

  const refresh = useCallback(() => void run(true), [run]);
  const cancel = useCallback(() => {
    const id = inFlight.current;
    if (id) void ipc.grpcCancel(id).catch(() => {}); // best-effort, like cancelStep
  }, []);

  return { catalog, loading, error, refresh, cancel };
}
