import * as ipc from "@/ipc/client";
import type { InvokeOutcomeIpc } from "@/ipc/bindings";
import { newStep, type MetadataRow, type Step } from "./model";
import { resolveStepTemplates } from "./resolve";

export interface CallTargetInit {
  address: string;
  tls: boolean;
}

export async function createStepFromMethod(
  target: CallTargetInit,
  service: string,
  method: string,
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
  return newStep({ address: target.address, tls: target.tls, service, method, requestJson });
}

export type SendResult =
  | { kind: "ok"; outcome: InvokeOutcomeIpc }
  | { kind: "error"; message: string }
  | { kind: "unresolved"; unresolved: string[]; cycle: string[] | null };

export async function sendStep(step: {
  address: string;
  tls: boolean;
  service: string;
  method: string;
  requestJson: string;
  metadata: MetadataRow[];
}): Promise<SendResult> {
  const r = await resolveStepTemplates(step, ipc.varsResolve);
  if (!r.ok) return { kind: "unresolved", unresolved: r.unresolved, cycle: r.cycle };
  const metadata: Record<string, string> = {};
  for (const m of r.request.metadata) metadata[m.key] = m.value;
  try {
    const outcome = await ipc.grpcInvokeOneshot(
      { address: r.request.address, tls: step.tls, skip_verify: false },
      { service: step.service, method: step.method, request_json: r.request.requestJson, metadata },
    );
    return { kind: "ok", outcome };
  } catch (e) {
    return { kind: "error", message: errorToMessage(e) };
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
