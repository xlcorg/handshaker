import * as ipc from "@/ipc/client";
import type { InvokeOutcomeIpc } from "@/ipc/bindings";
import { newStep, type MetadataRow, type Step } from "./model";

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
  | { kind: "error"; message: string };

function metadataToMap(rows: MetadataRow[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const r of rows) if (r.enabled && r.key) out[r.key] = r.value;
  return out;
}

export async function sendStep(step: {
  address: string;
  tls: boolean;
  service: string;
  method: string;
  requestJson: string;
  metadata: MetadataRow[];
}): Promise<SendResult> {
  try {
    const outcome = await ipc.grpcInvokeOneshot(
      { address: step.address, tls: step.tls, skip_verify: false },
      {
        service: step.service,
        method: step.method,
        request_json: step.requestJson,
        metadata: metadataToMap(step.metadata),
      },
    );
    return { kind: "ok", outcome };
  } catch (e) {
    return { kind: "error", message: errorToMessage(e) };
  }
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
