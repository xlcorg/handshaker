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

function methodKeyOf(service: string, method: string): string {
  return `${service}\0${method}`;
}

type HeldSchemas = {
  key: string;
  input: MessageSchemaIpc | null;
  output: MessageSchemaIpc | null;
};

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
  const methodKey = methodKeyOf(service, method);
  const [catalog, setCatalog] = useState<ServiceCatalogIpc | null>(null);
  const [held, setHeld] = useState<HeldSchemas | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef<string | null>(null);
  const generation = useRef(0);
  const activeKey = useRef(methodKey);
  activeKey.current = methodKey;

  const clearSchemas = () => setHeld(null);

  const run = useCallback(
    async (force: boolean) => {
      const my = ++generation.current;
      const myMethod = methodKeyOf(service, method);
      const live = () =>
        generation.current === my && activeKey.current === myMethod;
      const addr = addressTemplate.trim();
      if (!enabled || !addr) {
        if (!live()) return;
        setCatalog(null);
        clearSchemas();
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
        setHeld({
          key: myMethod,
          input: bundle.input_schema,
          output: bundle.output_schema,
        });
      } catch (e) {
        if (!live() || isCancelError(e)) return;
        setCatalog(null);
        clearSchemas();
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

  const runRef = useRef(run);
  runRef.current = run;

  const fetchedKey = useRef(methodKey);
  useEffect(() => {
    if (!enabled || !addressTemplate.trim()) {
      generation.current += 1;
      setCatalog(null);
      clearSchemas();
      setError(null);
      setLoading(false);
      return;
    }
    const methodChanged = fetchedKey.current !== methodKey;
    fetchedKey.current = methodKey;
    if (methodChanged) {
      void runRef.current(false);
      return;
    }
    const t = setTimeout(() => void runRef.current(false), DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [methodKey, enabled, addressTemplate, resolveKey, tlsOverride]);

  const refresh = useCallback(() => void run(true), [run]);
  const cancel = useCallback(() => {
    const id = inFlight.current;
    if (id) void ipc.grpcCancel(id).catch(() => {});
  }, []);

  const inputSchema = held?.key === methodKey ? held.input : null;
  const outputSchema = held?.key === methodKey ? held.output : null;

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
