import { useCallback, useEffect, useState } from "react";
import * as ipc from "@/ipc/client";
import type { ServiceCatalogIpc } from "@/ipc/bindings";
import { resolveAddressSafe } from "./actions";

const DEBOUNCE_MS = 400;

export interface DraftReflection {
  catalog: ServiceCatalogIpc | null;
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

function reflectErr(e: unknown): string {
  const t = e as { message?: string };
  return t?.message ?? "No reflection available at this address";
}

/** Reflect a draft's contract: debounced `grpcDescribe` on (address, tls) change, plus a
 *  manual `refresh()` that bypasses the backend cache via `grpcRefreshContract`. */
export function useDraftReflection(
  address: string,
  tls: boolean,
  enabled = true,
  collectionId: string | null = null,
): DraftReflection {
  const [catalog, setCatalog] = useState<ServiceCatalogIpc | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(
    async (force: boolean) => {
      const addr = address.trim();
      if (!enabled || !addr) {
        setCatalog(null);
        setError(null);
        setLoading(false);
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const resolved = await resolveAddressSafe(addr, collectionId);
        const target = { address: resolved, tls, skip_verify: false };
        const c = force ? await ipc.grpcRefreshContract(target) : await ipc.grpcDescribe(target);
        setCatalog(c);
      } catch (e) {
        setCatalog(null);
        setError(reflectErr(e));
      } finally {
        setLoading(false);
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

  return { catalog, loading, error, refresh };
}
