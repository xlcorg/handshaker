import { useCallback, useEffect, useRef, useState } from "react";
import * as ipc from "@/ipc/client";
import type {
  MessageSchemaIpc,
  MessageSideIpc,
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

function isMissingContract(e: unknown): boolean {
  const t = (e as { type?: string })?.type;
  return t === "ServiceNotFound" || t === "MethodNotFound";
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
        const catalogArtifact = await ipc.grpcContractRead(
          addr,
          tlsOverride,
          ctx,
          force ? { op: "refresh" } : { op: "catalog" },
          requestId,
          timeoutMs,
        );
        if (!live()) return;
        if (catalogArtifact.kind !== "catalog") {
          setCatalog(null);
          setInputSchema(null);
          setOutputSchema(null);
          setError("No reflection available at this address");
          return;
        }
        setCatalog(catalogArtifact.catalog);
        if (service.trim().length === 0 || method.trim().length === 0) {
          setInputSchema(null);
          setOutputSchema(null);
          return;
        }
        const input = await readSchema(
          addr,
          tlsOverride,
          ctx,
          service,
          method,
          "input",
          timeoutMs,
          inFlight,
        );
        if (!live()) return;
        const output = await readSchema(
          addr,
          tlsOverride,
          ctx,
          service,
          method,
          "output",
          timeoutMs,
          inFlight,
        );
        if (!live()) return;
        setInputSchema(input);
        setOutputSchema(output);
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

async function readSchema(
  address: string,
  tlsOverride: boolean | null,
  ctx: SendCtxIpc,
  service: string,
  method: string,
  side: MessageSideIpc,
  timeoutMs: number,
  inFlight: { current: string | null },
): Promise<MessageSchemaIpc | null> {
  const requestId = newId();
  inFlight.current = requestId;
  try {
    const artifact = await ipc.grpcContractRead(
      address,
      tlsOverride,
      ctx,
      { op: "schema", service, method, side },
      requestId,
      timeoutMs,
    );
    return artifact.kind === "schema" ? artifact.schema : null;
  } catch (e) {
    if (isMissingContract(e)) return null;
    throw e;
  }
}
