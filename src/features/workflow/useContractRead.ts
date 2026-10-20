import { useCallback, useEffect, useRef, useState } from "react";
import * as ipc from "@/ipc/client";
import type {
  MessageSchemaIpc,
  SendCtxIpc,
  ServiceCatalogIpc,
} from "@/ipc/bindings";
import { newId } from "@/lib/ids";
import { readPrefs } from "@/lib/use-prefs";
import { isCancelError } from "./netDiagnostics";
import type { ResolveKey } from "./resolveKey";

const DEBOUNCE_MS = 400;

export interface ContractReadState {
  catalog: ServiceCatalogIpc | null;
  inputSchema: MessageSchemaIpc | null;
  outputSchema: MessageSchemaIpc | null;
  loading: boolean;
  error: string | null;
  refresh: () => void;
  cancel: () => void;
}

function reflectErr(e: unknown): string {
  const t = e as { message?: string };
  return t?.message ?? "No reflection available at this address";
}

export function useContractRead(args: {
  addressTemplate: string;
  tlsOverride: boolean | null;
  collectionId: string | null;
  envName: string | null;
  service: string;
  method: string;
  resolveKey: ResolveKey;
  enabled: boolean;
}): ContractReadState {
  const {
    addressTemplate,
    tlsOverride,
    collectionId,
    envName,
    service,
    method,
    resolveKey,
    enabled,
  } = args;
  const [catalog, setCatalog] = useState<ServiceCatalogIpc | null>(null);
  const [inputSchema, setInputSchema] = useState<MessageSchemaIpc | null>(null);
  const [outputSchema, setOutputSchema] = useState<MessageSchemaIpc | null>(
    null,
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef<string | null>(null);
  const generation = useRef(0);

  const run = useCallback(
    async (force: boolean) => {
      const my = ++generation.current;
      const live = () => generation.current === my;
      const addr = addressTemplate.trim();
      if (!enabled || !addr) {
        if (!live()) return;
        setCatalog(null);
        setInputSchema(null);
        setOutputSchema(null);
        setError(null);
        setLoading(false);
        return;
      }
      const ctx: SendCtxIpc = {
        collection_id: collectionId,
        env_name: envName,
      };
      const timeoutMs = readPrefs().requestTimeoutMs;
      const requestId = newId();
      inFlight.current = requestId;
      setLoading(true);
      setError(null);
      try {
        const bundle = await ipc.grpcContractRead(
          addr,
          tlsOverride,
          ctx,
          { service, method, refresh: force },
          requestId,
          timeoutMs,
        );
        if (!live()) return;
        setCatalog(bundle.catalog);
        setInputSchema(bundle.input_schema);
        setOutputSchema(bundle.output_schema);
      } catch (e) {
        if (!live() || isCancelError(e)) return;
        setCatalog(null);
        setInputSchema(null);
        setOutputSchema(null);
        setError(reflectErr(e));
      } finally {
        if (live()) {
          inFlight.current = null;
          setLoading(false);
        }
      }
    },
    [
      addressTemplate,
      tlsOverride,
      collectionId,
      envName,
      service,
      method,
      enabled,
    ],
  );

  useEffect(() => {
    if (!enabled || !addressTemplate.trim()) {
      generation.current += 1;
      setCatalog(null);
      setInputSchema(null);
      setOutputSchema(null);
      setError(null);
      setLoading(false);
      return;
    }
    const t = setTimeout(() => void run(false), DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [run, enabled, addressTemplate, resolveKey]);

  const refresh = useCallback(() => void run(true), [run]);
  const cancel = useCallback(() => {
    const id = inFlight.current;
    if (id) void ipc.grpcCancel(id).catch(() => {});
  }, []);

  return {
    catalog,
    inputSchema,
    outputSchema,
    loading,
    error,
    refresh,
    cancel,
  };
}
