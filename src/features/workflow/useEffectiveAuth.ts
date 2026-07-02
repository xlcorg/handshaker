import { useEffect, useState } from "react";
import type { SavedAuthConfigIpc } from "@/ipc/bindings";
import { authEffective } from "@/ipc/client";

const NONE: SavedAuthConfigIpc = { kind: "none" };

export interface EffectiveAuthCtx {
  collection_id: string | null;
  env_name: string | null;
}

/** Effective auth ("which auth wins") for the Auth tab / history snapshot — asks core's
 *  `pick_auth_config` via the `auth_effective` command instead of re-deriving the pick in
 *  TS. Re-fetches on `revisionKey` (address-resolve key: env name + revision + collection —
 *  see `CallPanel.addressResolveKey`) as well as `stepAuth`/`ctx` identity changes. Defaults
 *  to `{ kind: "none" }` until the first fetch resolves; guards against a stale response
 *  landing after a newer request already started (last-fetch-wins). */
export function useEffectiveAuth(
  stepAuth: SavedAuthConfigIpc,
  ctx: EffectiveAuthCtx,
  revisionKey: string,
): SavedAuthConfigIpc {
  const [auth, setAuth] = useState<SavedAuthConfigIpc>(NONE);

  useEffect(() => {
    let cancelled = false;
    void authEffective(stepAuth, ctx).then((resolved) => {
      if (!cancelled) setAuth(resolved);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revisionKey, stepAuth, ctx.collection_id, ctx.env_name]);

  return auth;
}
