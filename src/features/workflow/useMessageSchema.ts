import { useEffect, useState } from "react";
import type { MessageSchemaIpc, MessageSideIpc } from "@/ipc/bindings";
import { fetchMessageSchemaSafe } from "./actions";

/** Process-wide cache keyed by address|tls|service|method|side. Holds null results too
 *  (a method whose schema couldn't be fetched), so we don't refetch on every focus. */
const cache = new Map<string, MessageSchemaIpc | null>();

export interface SchemaTarget {
  address: string;
  tls: boolean;
  service: string;
  method: string;
  collectionId?: string | null;
  /** Origin collection's `skip_tls_verify`; omitted/false ⇒ verify certs. */
  skipVerify?: boolean;
}

/** Returns the flat field-schema for the given call target and side, or null while
 *  loading / when unavailable / when no method is selected. Input and output sides are
 *  cached independently. Refetches when the key changes.
 *
 *  `revision` is a manual-refresh signal: bump it (in lockstep with re-reflecting the
 *  backend pool — see `useDraftReflection.refresh`) to force a refetch of an otherwise
 *  unchanged target. It is part of the cache key, so a bump is a cache miss → refetch;
 *  without it the process-wide cache would freeze the schema on its first result, and
 *  the contract/hints would never pick up a server-side change ("one-time action").
 *
 *  `resolveKey` is the active-env signal (env name + revision — see
 *  `CallPanel.addressResolveKey`). `address` is the raw `{{var}}` template, resolved live in
 *  `fetchMessageSchemaSafe`; switching/editing the active env changes the resolved host while
 *  the raw key stays put. Folding the env key in makes an env change a cache miss → refetch,
 *  so the Contract tab/hints don't freeze on the previous env (and a `null` cached under the
 *  old env can't leak into the new one). */
export function useMessageSchema(
  target: SchemaTarget,
  side: MessageSideIpc = "input",
  revision = 0,
  resolveKey = "",
): MessageSchemaIpc | null {
  const { address, tls, service, method, collectionId = null, skipVerify = false } = target;
  const key = `${address}|${tls}|${service}|${method}|${side}|${collectionId ?? ""}|${skipVerify}|${revision}|${resolveKey}`;
  const [schema, setSchema] = useState<MessageSchemaIpc | null>(() => cache.get(key) ?? null);

  useEffect(() => {
    if (method.trim().length === 0 || service.trim().length === 0) {
      setSchema(null);
      return;
    }
    if (cache.has(key)) {
      setSchema(cache.get(key) ?? null);
      return;
    }
    let cancelled = false;
    void fetchMessageSchemaSafe({ address, tls, collectionId, skipVerify }, service, method, side).then((s) => {
      cache.set(key, s);
      if (!cancelled) setSchema(s);
    });
    return () => {
      cancelled = true;
    };
  }, [key, address, tls, service, method, side, collectionId, skipVerify]);

  return schema;
}
