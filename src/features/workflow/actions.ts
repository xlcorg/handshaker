import * as ipc from "@/ipc/client";
import type { InvokeOutcomeIpc, SavedAuthConfigIpc, AuthCredentialsIpc, MessageSchemaIpc, MessageSideIpc } from "@/ipc/bindings";
import { newStep, type MetadataRow, type Step } from "./model";
import { resolveStepTemplates } from "./resolve";
import { lastExecutedFor, responseSeedPatch } from "./lastExecuted";
import { newId } from "@/lib/ids";
import { readPrefs } from "@/lib/use-prefs";
import { isCancelSentinel } from "./netDiagnostics";

export interface CallTargetInit {
  address: string;
  tls: boolean;
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
export async function resolveAddressSafe(address: string): Promise<string> {
  try {
    return (await ipc.varsResolve(address)).resolved;
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
    const address = await resolveAddressSafe(target.address);
    return await ipc.grpcBuildRequestSkeleton(
      { address, tls: target.tls, skip_verify: false },
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
    const address = await resolveAddressSafe(target.address);
    return await ipc.grpcMessageSchema({ address, tls: target.tls, skip_verify: false }, service, method, side);
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
    service,
    method,
    requestJson,
    auth: opts.auth ?? { kind: "none" },
    metadata: (opts.defaultMetadata ?? []).map((r) => ({ ...r })), // deep copy → editable
  });
}

export type SendResult =
  | { kind: "ok"; outcome: InvokeOutcomeIpc }
  | { kind: "error"; message: string }
  | { kind: "unresolved"; unresolved: string[]; cycle: string[] | null }
  | { kind: "cancelled" };

export type AuthHeader = { key: string; value: string };

export type AuthHeaderResult =
  | { kind: "none" }
  | { kind: "header"; header: AuthHeader }
  | { kind: "error"; message: string };

export async function resolveAuthHeader(
  auth: SavedAuthConfigIpc,
  authResolve: (c: SavedAuthConfigIpc) => Promise<AuthCredentialsIpc | null>,
): Promise<AuthHeaderResult> {
  if (auth.kind === "none") return { kind: "none" };
  try {
    const creds = await authResolve(auth);
    if (!creds) return { kind: "none" };
    return { kind: "header", header: { key: creds.header_name, value: creds.header_value } };
  } catch (e) {
    return { kind: "error", message: errorToMessage(e) };
  }
}

export async function sendStep(
  step: {
    address: string;
    tls: boolean;
    service: string;
    method: string;
    requestJson: string;
    metadata: MetadataRow[];
  },
  authHeader?: AuthHeader | null,
  opts?: { requestId?: string; timeoutMs?: number },
): Promise<SendResult> {
  const requestId = opts?.requestId ?? newId();
  const timeoutMs = opts?.timeoutMs ?? readPrefs().requestTimeoutMs;
  try {
    const r = await resolveStepTemplates(step, ipc.varsResolve);
    if (!r.ok) return { kind: "unresolved", unresolved: r.unresolved, cycle: r.cycle };
    const metadata: Record<string, string> = {};
    for (const m of r.request.metadata) metadata[m.key] = m.value;
    if (authHeader) metadata[authHeader.key] = authHeader.value; // verbatim, not {{var}}-resolved
    const outcome = await ipc.grpcInvokeOneshot(
      { address: r.request.address, tls: step.tls, skip_verify: false },
      { service: step.service, method: step.method, request_json: r.request.requestJson, metadata },
      requestId,
      timeoutMs,
    );
    return { kind: "ok", outcome };
  } catch (e) {
    const message = errorToMessage(e);
    if (isCancelSentinel(message)) return { kind: "cancelled" }; // exact sentinel, not fuzzy
    return { kind: "error", message };
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
    return {
      status: "error",
      outcome: null,
      error: res.cycle
        ? `Variable cycle: ${res.cycle.join(" → ")}`
        : `Unresolved variables: ${res.unresolved.map((v) => `{{${v}}}`).join(", ")}`,
    };
  }
  if (res.kind === "cancelled") {
    return { status: "draft", outcome: null, error: null };
  }
  return { status: "error", outcome: null, error: res.message };
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

function errorToMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (e && typeof e === "object") {
    const obj = e as Record<string, unknown>;
    if (typeof obj.message === "string") return obj.message;
    if (typeof obj.data === "string") return obj.data;
    if (typeof obj.type === "string") return obj.type;
  }
  return String(e);
}
