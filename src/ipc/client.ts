import { commands } from "./bindings";
import type {
  ConnectInput,
  ConnectOutcome,
  ServiceCatalogIpc,
  InvokeRequest,
  InvokeOutcomeIpc,
  EnvironmentIpc,
  ResolutionReportIpc,
} from "./bindings";

/**
 * Thin typed wrapper layer. We unwrap `Result<T, IpcError>` from tauri-specta
 * here so feature code can use `await` directly and catch errors via try/catch.
 */

export async function appVersion(): Promise<string> {
  const r = await commands.appVersion();
  return r.version;
}

export async function grpcConnect(input: ConnectInput): Promise<ConnectOutcome> {
  const r = await commands.grpcConnect(input);
  if (r.status === "error") throw r.error;
  return r.data;
}

export async function grpcDisconnect(): Promise<void> {
  const r = await commands.grpcDisconnect();
  if (r.status === "error") throw r.error;
}

export async function grpcRefreshContract(): Promise<ServiceCatalogIpc> {
  const r = await commands.grpcRefreshContract();
  if (r.status === "error") throw r.error;
  return r.data;
}

export async function grpcInvokeUnary(req: InvokeRequest): Promise<InvokeOutcomeIpc> {
  const r = await commands.grpcInvokeUnary(req);
  if (r.status === "error") throw r.error;
  return r.data;
}

export async function grpcBuildRequestSkeleton(
  service: string,
  method: string,
): Promise<string> {
  const r = await commands.grpcBuildRequestSkeleton(service, method);
  if (r.status === "error") throw r.error;
  return r.data;
}

export async function envList(): Promise<EnvironmentIpc[]> {
  const r = await commands.envList();
  if (r.status === "error") throw r.error;
  return r.data;
}

export async function envActiveGet(): Promise<string> {
  const r = await commands.envActiveGet();
  if (r.status === "error") throw r.error;
  return r.data;
}

export async function envActiveSet(name: string): Promise<void> {
  const r = await commands.envActiveSet(name);
  if (r.status === "error") throw r.error;
}

export async function envUpsert(env: EnvironmentIpc): Promise<void> {
  const r = await commands.envUpsert(env);
  if (r.status === "error") throw r.error;
}

export async function varsResolve(template: string): Promise<ResolutionReportIpc> {
  const r = await commands.varsResolve(template);
  if (r.status === "error") throw r.error;
  return r.data;
}

export const ipc = {
  appVersion,
  grpcConnect,
  grpcDisconnect,
  grpcRefreshContract,
  grpcInvokeUnary,
  grpcBuildRequestSkeleton,
  envList,
  envActiveGet,
  envActiveSet,
  envUpsert,
  varsResolve,
};
