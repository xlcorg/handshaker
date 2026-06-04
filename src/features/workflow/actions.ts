import * as ipc from "@/ipc/client";
import type { InvokeOutcomeIpc, SavedAuthConfigIpc, AuthCredentialsIpc } from "@/ipc/bindings";
import { newStep, type MetadataRow, type Step } from "./model";
import { resolveStepTemplates } from "./resolve";
import { newId } from "@/lib/ids";
import { readPrefs } from "@/lib/use-prefs";
import { isCancelSentinel } from "./netDiagnostics";

export interface CallTargetInit {
  address: string;
  tls: boolean;
}

export async function createStepFromMethod(
  target: CallTargetInit,
  service: string,
  method: string,
  opts: { serviceId?: string | null; defaultMetadata?: MetadataRow[] } = {},
): Promise<Step> {
  let requestJson = "{}";
  try {
    requestJson = await ipc.grpcBuildRequestSkeleton(
      { address: target.address, tls: target.tls, skip_verify: false },
      service,
      method,
    );
  } catch {
    requestJson = "{}";
  }
  return newStep({
    address: target.address,
    tls: target.tls,
    service,
    method,
    requestJson,
    serviceId: opts.serviceId ?? null,
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

export async function resolveStepAuthHeader(
  serviceId: string | null,
  getService: (id: string) => { auth: SavedAuthConfigIpc } | undefined,
  authResolve: (c: SavedAuthConfigIpc) => Promise<AuthCredentialsIpc | null>,
): Promise<AuthHeaderResult> {
  if (!serviceId) return { kind: "none" };
  const svc = getService(serviceId);
  if (!svc || svc.auth.kind === "none") return { kind: "none" };
  try {
    const creds = await authResolve(svc.auth);
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
