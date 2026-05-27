import { commands } from "./bindings";
import type {
  ConnectInput,
  ConnectOutcome,
  ServiceCatalogIpc,
  InvokeRequest,
  InvokeOutcomeIpc,
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

export const ipc = {
  appVersion,
  grpcConnect,
  grpcDisconnect,
  grpcRefreshContract,
  grpcInvokeUnary,
  grpcBuildRequestSkeleton,
};
