import { newId } from "@/lib/ids";
import type { InvokeOutcomeIpc } from "@/ipc/bindings";

export type ViewMode = "ledger" | "list" | "focus";
export type StepStatus = "draft" | "sending" | "ok" | "error";

export interface MetadataRow {
  key: string;
  value: string;
  enabled: boolean;
}

export interface Step {
  id: string;
  address: string; // resolved or {{var}} template
  tls: boolean;
  service: string; // proto service full name, e.g. "payments.v1.PaymentService"
  method: string; // method name, e.g. "GetPayment"
  serviceId: string | null; // origin catalog service, for live auth lookup at Send
  requestJson: string; // editable request body (skeleton-prefilled)
  metadata: MetadataRow[];
  status: StepStatus;
  outcome: InvokeOutcomeIpc | null;
  error: string | null; // client-side (non-gRPC) error message
}

export interface Workflow {
  id: string;
  name: string;
  steps: Step[];
  activeStepId: string | null;
  view: ViewMode;
  envName: string | null; // active environment for this workflow; null = "No environment"
}

export function newStep(init: {
  address: string;
  tls: boolean;
  service: string;
  method: string;
  requestJson?: string;
  metadata?: MetadataRow[];
  serviceId?: string | null;
}): Step {
  return {
    id: newId(),
    address: init.address,
    tls: init.tls,
    service: init.service,
    method: init.method,
    serviceId: init.serviceId ?? null,
    requestJson: init.requestJson ?? "{}",
    metadata: init.metadata ?? [],
    status: "draft",
    outcome: null,
    error: null,
  };
}

export function newWorkflow(name: string): Workflow {
  return { id: newId(), name, steps: [], activeStepId: null, view: "focus", envName: null };
}
