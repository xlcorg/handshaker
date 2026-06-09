import { useEffect, useState } from "react";
import type { MessageSchemaIpc } from "@/ipc/bindings";
import { fetchMessageSchemaSafe } from "./actions";

/** Process-wide cache keyed by address|tls|service|method. Holds null results too
 *  (a method whose schema couldn't be fetched), so we don't refetch on every focus. */
const cache = new Map<string, MessageSchemaIpc | null>();

export interface SchemaTarget {
  address: string;
  tls: boolean;
  service: string;
  method: string;
}

/** Returns the flat field-schema for the given call target, or null while loading /
 *  when unavailable / when no method is selected. Refetches when the key changes. */
export function useMessageSchema(target: SchemaTarget): MessageSchemaIpc | null {
  const { address, tls, service, method } = target;
  const key = `${address}|${tls}|${service}|${method}`;
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
    void fetchMessageSchemaSafe({ address, tls }, service, method).then((s) => {
      cache.set(key, s);
      if (!cancelled) setSchema(s);
    });
    return () => {
      cancelled = true;
    };
  }, [key, address, tls, service, method]);

  return schema;
}
