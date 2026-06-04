import { commands } from "./bindings";
import type {
  GrpcTargetIpc,
  ServiceCatalogIpc,
  InvokeRequest,
  InvokeOutcomeIpc,
  EnvironmentIpc,
  ResolutionReportIpc,
  CollectionIpc,
  CollectionMetaIpc,
  ItemIpc,
  ItemSnapshotIpc,
  SavedAuthConfigIpc,
  AuthCredentialsIpc,
} from "./bindings";

/**
 * Thin typed wrapper layer. We unwrap `Result<T, IpcError>` from tauri-specta
 * here so feature code can use `await` directly and catch errors via try/catch.
 */

export async function appVersion(): Promise<string> {
  const r = await commands.appVersion();
  return r.version;
}

export async function grpcDescribe(target: GrpcTargetIpc): Promise<ServiceCatalogIpc> {
  const r = await commands.grpcDescribe(target);
  if (r.status === "error") throw r.error;
  return r.data;
}

export async function grpcRefreshContract(target: GrpcTargetIpc): Promise<ServiceCatalogIpc> {
  const r = await commands.grpcRefreshContract(target);
  if (r.status === "error") throw r.error;
  return r.data;
}

export async function grpcBuildRequestSkeleton(
  target: GrpcTargetIpc,
  service: string,
  method: string,
): Promise<string> {
  const r = await commands.grpcBuildRequestSkeleton(target, service, method);
  if (r.status === "error") throw r.error;
  return r.data;
}

export async function grpcInvokeOneshot(
  target: GrpcTargetIpc,
  req: InvokeRequest,
): Promise<InvokeOutcomeIpc> {
  const r = await commands.grpcInvokeOneshot(target, req);
  if (r.status === "error") throw r.error;
  return r.data;
}

export async function envList(): Promise<EnvironmentIpc[]> {
  const r = await commands.envList();
  if (r.status === "error") throw r.error;
  return r.data;
}

export async function envActiveGet(): Promise<string | null> {
  const r = await commands.envActiveGet();
  if (r.status === "error") throw r.error;
  return r.data;
}

export async function envActiveSet(name: string | null): Promise<void> {
  const r = await commands.envActiveSet(name);
  if (r.status === "error") throw r.error;
}

export async function envUpsert(env: EnvironmentIpc): Promise<void> {
  const r = await commands.envUpsert(env);
  if (r.status === "error") throw r.error;
}

export async function envDelete(name: string): Promise<void> {
  const r = await commands.envDelete(name);
  if (r.status === "error") throw r.error;
}

export async function varsResolve(template: string): Promise<ResolutionReportIpc> {
  const r = await commands.varsResolve(template);
  if (r.status === "error") throw r.error;
  return r.data;
}

export async function collectionList(): Promise<CollectionMetaIpc[]> {
  const r = await commands.collectionList();
  if (r.status === "error") throw r.error;
  return r.data;
}

export async function collectionGet(id: string): Promise<CollectionIpc> {
  const r = await commands.collectionGet(id);
  if (r.status === "error") throw r.error;
  return r.data;
}

export async function collectionUpsert(collection: CollectionIpc): Promise<void> {
  const r = await commands.collectionUpsert(collection);
  if (r.status === "error") throw r.error;
}

export async function collectionDelete(id: string): Promise<void> {
  const r = await commands.collectionDelete(id);
  if (r.status === "error") throw r.error;
}

export async function collectionSetVariables(id: string, vars: Partial<{ [key in string]: string }>): Promise<void> {
  const r = await commands.collectionSetVariables(id, vars);
  if (r.status === "error") throw r.error;
}

export async function collectionAddItem(collectionId: string, parentId: string | null, item: ItemIpc): Promise<void> {
  const r = await commands.collectionAddItem(collectionId, parentId, item);
  if (r.status === "error") throw r.error;
}

export async function collectionRenameItem(collectionId: string, itemId: string, name: string): Promise<void> {
  const r = await commands.collectionRenameItem(collectionId, itemId, name);
  if (r.status === "error") throw r.error;
}

export async function collectionMoveItem(collectionId: string, itemId: string, newParentId: string | null, position: number): Promise<void> {
  const r = await commands.collectionMoveItem(collectionId, itemId, newParentId, position);
  if (r.status === "error") throw r.error;
}

export async function collectionDuplicateItem(collectionId: string, itemId: string): Promise<string> {
  const r = await commands.collectionDuplicateItem(collectionId, itemId);
  if (r.status === "error") throw r.error;
  return r.data;
}

export async function collectionDeleteItem(collectionId: string, itemId: string): Promise<ItemSnapshotIpc | null> {
  const r = await commands.collectionDeleteItem(collectionId, itemId);
  if (r.status === "error") throw r.error;
  return r.data;
}

export async function collectionRestoreItem(collectionId: string, snapshot: ItemSnapshotIpc, parentId: string | null, position: number): Promise<void> {
  const r = await commands.collectionRestoreItem(collectionId, snapshot, parentId, position);
  if (r.status === "error") throw r.error;
}

export async function authSetForEnv(collectionId: string, itemId: string | null, envName: string, config: SavedAuthConfigIpc | null): Promise<void> {
  const r = await commands.authSetForEnv(collectionId, itemId, envName, config);
  if (r.status === "error") throw r.error;
}

export async function authResolve(
  config: SavedAuthConfigIpc,
): Promise<AuthCredentialsIpc | null> {
  const r = await commands.authResolve(config);
  if (r.status === "error") throw r.error;
  return r.data;
}

export const ipc = {
  appVersion,
  grpcDescribe,
  grpcRefreshContract,
  grpcInvokeOneshot,
  grpcBuildRequestSkeleton,
  envList,
  envActiveGet,
  envActiveSet,
  envUpsert,
  envDelete,
  varsResolve,
  collectionList,
  collectionGet,
  collectionUpsert,
  collectionDelete,
  collectionSetVariables,
  collectionAddItem,
  collectionRenameItem,
  collectionMoveItem,
  collectionDuplicateItem,
  collectionDeleteItem,
  collectionRestoreItem,
  authSetForEnv,
  authResolve,
};
