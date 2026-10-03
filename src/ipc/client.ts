import { Channel } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";

import { commands } from "./bindings";
import { newId } from "@/lib/ids";
import type {
  GrpcTargetIpc,
  ServiceCatalogIpc,
  CallOptionsIpc,
  EnvironmentIpc,
  ResolutionReportIpc,
  VarsResolveCtxIpc,
  CollectionIpc,
  CollectionMetaIpc,
  ItemIpc,
  ItemSnapshotIpc,
  SavedAuthConfigIpc,
  AuthCredentialsIpc,
  OAuth2TokenInfoIpc,
  UiStateIpc,
  MessageSchemaIpc,
  MessageSideIpc,
  Base64InspectIpc,
  ImportSummaryIpc,
  ImportResultIpc,
  SendCtxIpc,
  SendDraftIpc,
  SendReportIpc,
  MethodKindIpc,
  StreamEventIpc,
  AssembleResultIpc,
  OutboundMessageIpc,
} from "./bindings";

/**
 * Thin typed wrapper layer. We unwrap `Result<T, IpcError>` from tauri-specta
 * here so feature code can use `await` directly and catch errors via try/catch.
 */

export async function appVersion(): Promise<string> {
  const r = await commands.appVersion();
  return r.version;
}

/** Drain the list of files quarantined as corrupt during startup load (one-shot). */
export async function startupRecoveryTake(): Promise<string[]> {
  const r = await commands.startupRecoveryTake();
  if (r.status === "error") throw r.error;
  return r.data;
}

// Reflection carries the same (requestId, deadline) surface as invoke, so a slow/hung
// describe times out and can be aborted via `grpcCancel(requestId)`. Defaults serve any
// caller without a cancel/timeout surface: a fresh id keeps registry entries unique,
// 30_000ms mirrors the deadline pref default.
export async function grpcDescribe(
  target: GrpcTargetIpc,
  requestId = newId(),
  timeoutMs = 30_000,
): Promise<ServiceCatalogIpc> {
  const r = await commands.grpcDescribe(target, requestId, timeoutMs);
  if (r.status === "error") throw r.error;
  return r.data;
}

export async function grpcRefreshContract(
  target: GrpcTargetIpc,
  requestId = newId(),
  timeoutMs = 30_000,
): Promise<ServiceCatalogIpc> {
  const r = await commands.grpcRefreshContract(target, requestId, timeoutMs);
  if (r.status === "error") throw r.error;
  return r.data;
}

export async function grpcBuildRequestSkeleton(
  target: GrpcTargetIpc,
  service: string,
  method: string,
  // On a cache miss the backend dials the endpoint, so carry the same (requestId,
  // deadline) surface as describe/invoke: a fresh id bounds the registry entry and
  // 30_000ms caps an otherwise-unbounded reflection hang.
  requestId = newId(),
  timeoutMs = 30_000,
): Promise<string> {
  const r = await commands.grpcBuildRequestSkeleton(target, service, method, requestId, timeoutMs);
  if (r.status === "error") throw r.error;
  return r.data;
}

export async function grpcMessageSchema(
  target: GrpcTargetIpc,
  service: string,
  method: string,
  side: MessageSideIpc,
  requestId = newId(),
  timeoutMs = 30_000,
): Promise<MessageSchemaIpc> {
  const r = await commands.grpcMessageSchema(target, service, method, side, requestId, timeoutMs);
  if (r.status === "error") throw r.error;
  return r.data;
}

/** Live Send: forwards the raw draft (templates + step's own auth) + resolve ctx to
 *  `grpc_send`, which resolves vars/auth/TLS through the core pipeline before invoking. */
export async function grpcSend(
  draft: SendDraftIpc,
  ctx: SendCtxIpc,
  requestId: string,
  opts: CallOptionsIpc,
): Promise<SendReportIpc> {
  const r = await commands.grpcSend(draft, ctx, requestId, opts);
  if (r.status === "error") throw r.error;
  return r.data;
}

/** The one cancel entry point for unary and stream calls alike (unary registry first,
 *  then the stream registry). */
export async function grpcCancel(requestId: string): Promise<void> {
  const r = await commands.grpcCancel(requestId);
  if (r.status === "error") throw r.error;
}

/** Sink for one stream call's events (`Opened → Headers → Message* → End | Fault`). */
export type StreamEventHandler = (event: StreamEventIpc) => void;

/** Open a stream call: forwards the raw draft + resolve ctx + the kind the UI derived to
 *  `stream_open`, wrapping `onEvent` in a per-call `Channel`. Resolves when the call is
 *  open (`Opened` emitted); rejects only for a pre-Open fault — every later outcome
 *  (`End`, `Fault`) arrives on `onEvent`. Cancel via `grpcCancel(requestId)`; free the
 *  store via `streamRelease(requestId)`. */
export async function streamOpen(
  draft: SendDraftIpc,
  ctx: SendCtxIpc,
  requestId: string,
  kind: MethodKindIpc,
  opts: CallOptionsIpc,
  onEvent: StreamEventHandler,
): Promise<void> {
  const channel = new Channel<StreamEventIpc>(onEvent);
  const r = await commands.streamOpen(draft, ctx, requestId, kind, opts, channel);
  if (r.status === "error") throw r.error;
}

/** **Send message** on the open stream call `requestId`: `bodyTemplate` is the current
 *  body with its `{{var}}` / `{{$builtin}}` templates intact — core resolves it against
 *  the `ctx` collection / env of this moment (auth is never re-materialized). Resolves to
 *  the ack row for the timeline (`index` in the numbering shared with inbound rows,
 *  `at_ms`, `size_bytes`, `preview`) plus the resolved `json` that went on the wire; the
 *  ack means the transport accepted the message (headers need not have arrived yet).
 *  Rejects with `StreamClosed` before `Opened` / after half-close, end or cancel, and with
 *  `UnresolvedVars` / `EncodeRequest` for a bad body — the call stays open. */
export async function streamSend(
  requestId: string,
  bodyTemplate: string,
  ctx: SendCtxIpc,
): Promise<OutboundMessageIpc> {
  const r = await commands.streamSend(requestId, bodyTemplate, ctx);
  if (r.status === "error") throw r.error;
  return r.data;
}

/** **Half-close** the outbound side of the stream call `requestId`: the request stream
 *  ends on the wire, later `streamSend`s are refused, and the deadline pref starts
 *  bounding the server's answer (half-close → stream start). Idempotent while the call is
 *  registered; rejects with `StreamClosed` for an unknown id. */
export async function streamHalfClose(requestId: string): Promise<void> {
  const r = await commands.streamHalfClose(requestId);
  if (r.status === "error") throw r.error;
}

/** Full pretty JSON of one inbound message (1-based timeline `index`), decoded on demand
 *  from the backend Stream store — the timeline calls this on expand for rows whose
 *  `Message.json` came as `null` (> 64 KiB). Rejects with `StreamMessageNotFound` for an
 *  unknown id / index (released store). */
export async function streamMessage(requestId: string, index: number): Promise<string> {
  const r = await commands.streamMessage(requestId, index);
  if (r.status === "error") throw r.error;
  return r.data;
}

/** Free the backend Stream store of a call no step references any more. */
export async function streamRelease(requestId: string): Promise<void> {
  const r = await commands.streamRelease(requestId);
  if (r.status === "error") throw r.error;
}

/** **Save messages**: every inbound message of the stream call `requestId` as one JSON
 *  array (oldest first, outbound excluded), built by core from the Stream store and written
 *  through the native Save-As dialog (default `response-<localstamp>.json`). Resolves to
 *  the saved path, or `null` when the user cancelled the dialog. Rejects with
 *  `StreamNotFound` once the store was released. */
export async function streamSaveMessages(requestId: string): Promise<string | null> {
  const r = await commands.streamSaveMessages(requestId);
  if (r.status === "error") throw r.error;
  return r.data;
}

/** **Assemble**: one file from the `fieldPath` bytes field (one of `Opened.bytes_fields`)
 *  of every inbound message of `requestId`, streamed to disk by core through the native
 *  Save-As dialog (default name from the first message's `name` field, else
 *  `stream-<stamp>.<ext>`). Resolves to `{ path, written, total, size_bytes }` — messages
 *  without the field are skipped — or `null` when the user cancelled. Rejects with
 *  `StreamNotFound` / `StreamFieldNotFound` before any dialog opens. */
export async function streamAssemble(requestId: string, fieldPath: string): Promise<AssembleResultIpc | null> {
  const r = await commands.streamAssemble(requestId, fieldPath);
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

export async function envReorder(names: string[]): Promise<void> {
  const r = await commands.envReorder(names);
  if (r.status === "error") throw r.error;
}

export async function varsResolve(
  template: string,
  ctx: VarsResolveCtxIpc | null = null,
): Promise<ResolutionReportIpc> {
  const r = await commands.varsResolve(template, ctx);
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

export async function collectionMoveItemAcross(
  sourceCollectionId: string,
  itemId: string,
  targetCollectionId: string,
  newParentId: string | null,
  position: number,
): Promise<void> {
  const r = await commands.collectionMoveItemAcross(sourceCollectionId, itemId, targetCollectionId, newParentId, position);
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

/** Record one execution of a saved request: sets `last_used_at` and increments `use_count`
 *  (persisted backend-side). Drives the "Recent" / "Most used" collection sorts. */
export async function collectionBumpUsage(collectionId: string, itemId: string, usedAt: number): Promise<void> {
  const r = await commands.collectionBumpUsage(collectionId, itemId, usedAt);
  if (r.status === "error") throw r.error;
}

export async function bundleExport(path: string, collectionId: string | null): Promise<void> {
  const r = await commands.bundleExport(path, collectionId);
  if (r.status === "error") throw r.error;
}

export async function bundleImportInspect(path: string): Promise<ImportSummaryIpc> {
  const r = await commands.bundleImportInspect(path);
  if (r.status === "error") throw r.error;
  return r.data;
}

export async function bundleImportApply(path: string): Promise<ImportResultIpc> {
  const r = await commands.bundleImportApply(path);
  if (r.status === "error") throw r.error;
  return r.data;
}

export async function authResolve(
  config: SavedAuthConfigIpc,
): Promise<AuthCredentialsIpc | null> {
  const r = await commands.authResolve(config);
  if (r.status === "error") throw r.error;
  return r.data;
}

export async function authOauth2FetchToken(
  config: SavedAuthConfigIpc,
): Promise<OAuth2TokenInfoIpc> {
  const r = await commands.authOauth2FetchToken(config);
  if (r.status === "error") throw r.error;
  return r.data;
}

export async function authInvalidate(config: SavedAuthConfigIpc): Promise<void> {
  const r = await commands.authInvalidate(config);
  if (r.status === "error") throw r.error;
}

export async function authEffective(
  stepAuth: SavedAuthConfigIpc,
  ctx: SendCtxIpc,
): Promise<SavedAuthConfigIpc> {
  const r = await commands.authEffective(stepAuth, ctx);
  if (r.status === "error") throw r.error;
  return r.data;
}

export async function collectionSetNodeAuth(
  collectionId: string,
  itemId: string | null,
  config: SavedAuthConfigIpc,
): Promise<void> {
  const r = await commands.collectionSetNodeAuth(collectionId, itemId, config);
  if (r.status === "error") throw r.error;
}

export async function collectionSetExpanded(
  collectionId: string,
  itemId: string | null,
  expanded: boolean,
): Promise<void> {
  const r = await commands.collectionSetExpanded(collectionId, itemId, expanded);
  if (r.status === "error") throw r.error;
}

export async function appSettingsGet(): Promise<UiStateIpc> {
  const r = await commands.appSettingsGet();
  if (r.status === "error") throw r.error;
  return r.data;
}

export async function appSettingsSet(patch: UiStateIpc): Promise<void> {
  const r = await commands.appSettingsSet(patch);
  if (r.status === "error") throw r.error;
}

export async function base64Inspect(input: string): Promise<Base64InspectIpc> {
  const r = await commands.base64Inspect(input);
  if (r.status === "error") throw r.error;
  return r.data;
}

export async function base64Save(input: string): Promise<string | null> {
  const r = await commands.base64Save(input);
  if (r.status === "error") throw r.error;
  return r.data;
}

export async function base64SaveEncoded(input: string): Promise<string | null> {
  const r = await commands.base64SaveEncoded(input);
  if (r.status === "error") throw r.error;
  return r.data;
}

export async function fileSaveText(text: string, defaultName: string): Promise<string | null> {
  const r = await commands.fileSaveText(text, defaultName);
  if (r.status === "error") throw r.error;
  return r.data;
}

/** Hand `url` to the OS default browser. The single seam for leaving the app —
 *  callers pass a FULLY RESOLVED url; `{{var}}` templates never cross it. */
export async function openExternal(url: string): Promise<void> {
  await openUrl(url);
}

export const ipc = {
  appVersion,
  startupRecoveryTake,
  grpcDescribe,
  grpcRefreshContract,
  grpcSend,
  grpcCancel,
  streamOpen,
  streamSend,
  streamHalfClose,
  streamMessage,
  streamRelease,
  streamSaveMessages,
  streamAssemble,
  grpcBuildRequestSkeleton,
  grpcMessageSchema,
  envList,
  envActiveGet,
  envActiveSet,
  envUpsert,
  envDelete,
  envReorder,
  varsResolve,
  collectionList,
  collectionGet,
  collectionUpsert,
  collectionDelete,
  collectionSetVariables,
  collectionAddItem,
  collectionRenameItem,
  collectionMoveItem,
  collectionMoveItemAcross,
  collectionDuplicateItem,
  collectionDeleteItem,
  collectionRestoreItem,
  collectionBumpUsage,
  bundleExport,
  bundleImportInspect,
  bundleImportApply,
  authResolve,
  authOauth2FetchToken,
  authInvalidate,
  authEffective,
  collectionSetNodeAuth,
  collectionSetExpanded,
  appSettingsGet,
  appSettingsSet,
  base64Inspect,
  base64Save,
  base64SaveEncoded,
  fileSaveText,
  openExternal,
};
