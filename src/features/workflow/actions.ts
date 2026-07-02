import * as ipc from "@/ipc/client";
import type { InvokeOutcomeIpc, SavedAuthConfigIpc, ResolutionReportIpc, MessageSchemaIpc, MessageSideIpc, VarsResolveCtxIpc, SendDraftIpc, SendCtxIpc, CallOptionsIpc } from "@/ipc/bindings";
import { newStep, type MetadataRow, type Step } from "./model";
import { lastExecutedFor, responseSeedPatch } from "./lastExecuted";
import { newId } from "@/lib/ids";
import { readPrefs } from "@/lib/use-prefs";
import { faultFromUnknown, isCancelError, isObj, type ClientFault } from "./netDiagnostics";

/** A template resolver bound to a particular `{{var}}` source (collection/env ctx). */
export type Resolver = (template: string) => Promise<ResolutionReportIpc>;

export interface CallTargetInit {
  address: string;
  tls: boolean;
  /** Owning collection for {{var}} resolution; null/omitted ⇒ no collection vars. */
  collectionId?: string | null;
  /** Origin collection's `skip_tls_verify`; omitted/false ⇒ verify certs (mirrors Send). */
  skipVerify?: boolean;
}

/** Resolve ctx for a step bound to `collectionId`; null when unbound. */
export function varsCtxFor(collectionId: string | null | undefined): VarsResolveCtxIpc | null {
  return collectionId
    ? { collection_id: collectionId, collection_vars: null, env_vars: null }
    : null;
}

/** A Resolver with the collection ctx baked in — inject into resolve/auth deps. */
export function varsResolverFor(collectionId: string | null | undefined): Resolver {
  return (t) => ipc.varsResolve(t, varsCtxFor(collectionId));
}

/** Initial request body for a fresh or just-switched method: an empty object split
 *  across two lines so the ghost contract skeleton renders between the braces
 *  (a one-line `{}` has no interior line, so the ghost is suppressed entirely).
 *  The full value template stays one click away — Reset-to-template (↺). */
export const EMPTY_BODY_TEMPLATE = "{\n}";

/** Canonical JSON string (whitespace-normalized), or undefined if `s` is not JSON. */
function canonicalJson(s: string): string | undefined {
  try {
    return JSON.stringify(JSON.parse(s));
  } catch {
    return undefined;
  }
}

/** True when `body` is still the unedited skeleton (or empty), so a method switch may
 *  safely replace it. Whitespace/formatting differences are NOT edits; invalid JSON is. */
export function isPristineBody(body: string, skeleton: string): boolean {
  if (body.trim() === "") return true;
  const cb = canonicalJson(body);
  if (cb === "{}") return true; // empty object in any formatting (incl. EMPTY_BODY_TEMPLATE)
  const cs = canonicalJson(skeleton);
  if (cs === undefined) return body.trim() === skeleton.trim(); // skeleton is non-JSON → string compare
  if (cb === undefined) return false; // mid-edit, invalid JSON → preserve
  return cb === cs;
}

/** Best-effort `{{var}}` resolution for a connection address. Unresolved placeholders are
 *  left literal (the subsequent gRPC call surfaces the failure), mirroring the Send path so
 *  reflection/skeleton dial the same resolved host the eventual invoke will. */
export async function resolveAddressSafe(
  address: string,
  collectionId: string | null = null,
): Promise<string> {
  try {
    return (await ipc.varsResolve(address, varsCtxFor(collectionId))).resolved;
  } catch {
    return address;
  }
}

/** Fetch a request-body skeleton for a method; never throws — falls back to "{}". */
export async function buildRequestSkeletonSafe(
  target: CallTargetInit,
  service: string,
  method: string,
): Promise<string> {
  try {
    const address = await resolveAddressSafe(target.address, target.collectionId ?? null);
    return await ipc.grpcBuildRequestSkeleton(
      { address, tls: target.tls, skip_verify: target.skipVerify ?? false },
      service,
      method,
    );
  } catch {
    return "{}";
  }
}

/** Fetch the flat field-schema for a method's input or output message; never throws — returns
 *  null on any failure (no reflection / server down / unknown method). A null schema
 *  degrades gracefully: request autocomplete, the ghost skeleton, and the contract
 *  view are all suppressed, but the editor remains functional. */
export async function fetchMessageSchemaSafe(
  target: CallTargetInit,
  service: string,
  method: string,
  side: MessageSideIpc = "input",
): Promise<MessageSchemaIpc | null> {
  try {
    const address = await resolveAddressSafe(target.address, target.collectionId ?? null);
    return await ipc.grpcMessageSchema(
      { address, tls: target.tls, skip_verify: target.skipVerify ?? false },
      service,
      method,
      side,
    );
  } catch {
    return null;
  }
}

/** MethodPicker handler for an editable draft. Patches service/method (+ the response
 *  fields: this session's last executed call of the new method, or a clean panel),
 *  then resets the body to `EMPTY_BODY_TEMPLATE` ONLY when the current body is still
 *  pristine (empty / `{}` / structurally equal to the pre-switch method's skeleton).
 *  No autofill: the contract renders as the ghost skeleton instead. */
export async function applyMethodSelection(
  patch: (p: Partial<Step>) => void,
  target: CallTargetInit,
  current: { requestJson: string; service: string; method: string },
  m: { service: string; method: string },
  history: Step[] = [],
): Promise<void> {
  const oldSkeleton = await buildRequestSkeletonSafe(target, current.service, current.method);
  const pristine = isPristineBody(current.requestJson, oldSkeleton);
  const last = lastExecutedFor(history, {
    service: m.service,
    method: m.method,
    address: target.address,
  });
  patch({ service: m.service, method: m.method, ...responseSeedPatch(last) });
  if (pristine) patch({ requestJson: EMPTY_BODY_TEMPLATE });
}

/** Force-regenerate the request body from the current method's skeleton (Reset-to-template).
 *  Never throws — `buildRequestSkeletonSafe` falls back to `"{}"`. The overwrite flows through
 *  the editor's controlled `value`, so Ctrl+Z reverts it. */
export async function resetBodyToTemplate(
  patch: (p: Partial<Step>) => void,
  target: CallTargetInit,
  service: string,
  method: string,
): Promise<void> {
  const requestJson = await buildRequestSkeletonSafe(target, service, method);
  patch({ requestJson });
}

export async function createStepFromMethod(
  target: CallTargetInit,
  service: string,
  method: string,
  opts: { auth?: SavedAuthConfigIpc; defaultMetadata?: MetadataRow[] } = {},
): Promise<Step> {
  const requestJson = EMPTY_BODY_TEMPLATE; // no autofill — the contract shows as ghost
  return newStep({
    address: target.address,
    tls: target.tls,
    collectionId: target.collectionId ?? null,
    service,
    method,
    requestJson,
    auth: opts.auth ?? { kind: "none" },
    metadata: (opts.defaultMetadata ?? []).map((r) => ({ ...r })), // deep copy → editable
  });
}

export type SendResult =
  | { kind: "ok"; outcome: InvokeOutcomeIpc }
  | { kind: "error"; fault: ClientFault }
  | { kind: "unresolved"; unresolved: string[]; cycle: string[] | null }
  | { kind: "cancelled" };

type Oauth2Config = Extract<SavedAuthConfigIpc, { kind: "oauth2_client_credentials" }>;

/** Resolve `{{var}}` in every oauth2 template field. Returns the resolved config, or
 *  the list of unresolved variable names. */
export async function resolveOauthConfig(
  auth: Oauth2Config,
  varsResolve: (t: string) => Promise<ResolutionReportIpc>,
): Promise<{ ok: true; config: Oauth2Config } | { ok: false; message: string }> {
  const unresolved: string[] = [];
  const take = async (t: string): Promise<string> => {
    const r = await varsResolve(t);
    for (const v of r.unresolved_vars) if (!unresolved.includes(v)) unresolved.push(v);
    return r.resolved;
  };
  const token_url = await take(auth.token_url);
  const client_id = await take(auth.client_id);
  const client_secret = await take(auth.client_secret);
  const scopes: string[] = [];
  for (const s of auth.scopes) scopes.push(await take(s));
  if (unresolved.length > 0) {
    return {
      ok: false,
      message: `Unresolved variables: ${unresolved.map((v) => `{{${v}}}`).join(", ")}`,
    };
  }
  return {
    ok: true,
    config: {
      kind: "oauth2_client_credentials",
      token_url,
      client_id,
      client_secret,
      scopes,
      header_name: auth.header_name,
      prefix: auth.prefix,
      environments: auth.environments,
    },
  };
}

/** Live Send: forward the raw draft (templates + the step's own auth) + resolve ctx
 *  to `grpc_send`, which owns the whole pipeline (vars → auth pick/materialize → TLS →
 *  invoke → 16-invalidation). No frontend resolution left to do — this is call+map. */
export async function sendStep(
  step: {
    address: string;
    tls: boolean;
    service: string;
    method: string;
    requestJson: string;
    metadata: MetadataRow[];
    auth: SavedAuthConfigIpc;
    collectionId?: string | null;
  },
  ctx: { envName: string | null },
  opts?: { requestId?: string; timeoutMs?: number; maxMessageBytes?: number },
): Promise<SendResult> {
  const requestId = opts?.requestId ?? newId();
  const prefs = readPrefs();
  const draft: SendDraftIpc = {
    address_template: step.address,
    tls: step.tls,
    service: step.service,
    method: step.method,
    body_template: step.requestJson,
    metadata: step.metadata
      .filter((m) => m.enabled && m.key)
      .map((m) => ({ key: m.key, value: m.value, enabled: true })),
    auth: step.auth,
  };
  const sendCtx: SendCtxIpc = { collection_id: step.collectionId ?? null, env_name: ctx.envName };
  const callOpts: CallOptionsIpc = {
    timeout_ms: opts?.timeoutMs ?? prefs.requestTimeoutMs,
    max_message_bytes: opts?.maxMessageBytes ?? prefs.maxMessageBytes,
  };
  try {
    const outcome = await ipc.grpcSend(draft, sendCtx, requestId, callOpts);
    return { kind: "ok", outcome };
  } catch (e) {
    if (isCancelError(e)) return { kind: "cancelled" };
    if (isObj(e) && e.type === "UnresolvedVars") {
      return {
        kind: "unresolved",
        unresolved: e.unresolved as string[],
        cycle: (e.cycle as string[] | null) ?? null,
      };
    }
    return { kind: "error", fault: faultFromUnknown(e) };
  }
}

/** Best-effort cancel of an in-flight invoke. Errors are swallowed (the call may have
 *  already completed and dropped its registry entry). */
export async function cancelStep(requestId: string): Promise<void> {
  try {
    await ipc.grpcCancel(requestId);
  } catch {
    /* best-effort */
  }
}

export function stepPatchFromSendResult(res: SendResult): Partial<Step> {
  if (res.kind === "ok") {
    return { status: res.outcome.status_code === 0 ? "ok" : "error", outcome: res.outcome, error: null };
  }
  if (res.kind === "unresolved") {
    const message = res.cycle
      ? `Variable cycle: ${res.cycle.join(" → ")}`
      : `Unresolved variables: ${res.unresolved.map((v) => `{{${v}}}`).join(", ")}`;
    return { status: "error", outcome: null, error: { kind: "other", message } };
  }
  if (res.kind === "cancelled") {
    return { status: "draft", outcome: null, error: null };
  }
  return { status: "error", outcome: null, error: res.fault };
}

/** Whether a Send result represents a call that reached the server and should be
 *  recorded as an executed history step (gRPC responded — success or non-zero status). */
export function shouldRecordExecuted(res: SendResult): boolean {
  return res.kind === "ok";
}

/** A frozen executed-history snapshot of `draft` with the Send patch applied and a fresh id. */
export function buildExecutedStep(draft: Step, patch: Partial<Step>): Step {
  return { ...draft, ...patch, id: newId(), requestId: null };
}
