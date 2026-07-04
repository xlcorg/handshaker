import { newId } from "@/lib/ids";
import type { InvokeOutcomeIpc, SavedAuthConfigIpc } from "@/ipc/bindings";
import type { ClientFault } from "./netDiagnostics";

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
  /** Per-request TLS override. `null` = inherit the origin collection's `default_tls`
   *  (resolved at Send/probe time); `true`/`false` = explicit on/off. Freezing a bool
   *  here is what caused the "saved request connects with the wrong TLS mode" bug. */
  tls: boolean | null;
  service: string; // proto service full name, e.g. "payments.v1.PaymentService"
  method: string; // method name, e.g. "GetPayment"
  auth: SavedAuthConfigIpc; // inline auth for this call (resolved at Send)
  /** Owning collection of the saved request this step came from — the {{var}}
   *  resolve context. null = unbound draft (no collection variables). */
  collectionId: string | null;
  requestJson: string; // editable request body (skeleton-prefilled)
  metadata: MetadataRow[];
  status: StepStatus;
  outcome: InvokeOutcomeIpc | null;
  error: ClientFault | null; // client-side (non-gRPC) failure, structured for the face
  requestId: string | null; // transient: in-flight invoke id while status === "sending"
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
  /** Omit / `null` ⇒ inherit the collection default_tls (the sane default for a new or
   *  saved request); pass a bool only for an explicit per-request override. */
  tls?: boolean | null;
  service: string;
  method: string;
  requestJson?: string;
  metadata?: MetadataRow[];
  auth?: SavedAuthConfigIpc;
  collectionId?: string | null;
}): Step {
  return {
    id: newId(),
    address: init.address,
    tls: init.tls ?? null,
    service: init.service,
    method: init.method,
    auth: init.auth ?? { kind: "none" },
    collectionId: init.collectionId ?? null,
    requestJson: init.requestJson ?? "{}",
    metadata: init.metadata ?? [],
    status: "draft",
    outcome: null,
    error: null,
    requestId: null,
  };
}

export function newWorkflow(name: string): Workflow {
  return { id: newId(), name, steps: [], activeStepId: null, view: "focus", envName: null };
}
