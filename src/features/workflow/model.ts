import { newId } from "@/lib/ids";
import type { InvokeOutcomeIpc, SavedAuthConfigIpc } from "@/ipc/bindings";
import type { HttpStep } from "@/features/http/model";
import type { ClientFault } from "./netDiagnostics";

/** `"cancelled"` is a Stream call terminal state (rows stay); a cancelled unary Send
 *  returns to `"draft"`. */
export type StepStatus = "draft" | "sending" | "ok" | "error" | "cancelled";

export interface MetadataRow {
  key: string;
  value: string;
  enabled: boolean;
}

export interface Step {
  protocol: "grpc";
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
  /** Stream call this step last opened (= its request id in the Stream store); null =
   *  unary. Replaced by a fresh id on re-Open; the release rule frees ids no step
   *  references any more. `outcome` stays unary-only. */
  streamId: string | null;
}

/** The single Focus draft slot holds either protocol. */
export type Draft = Step | HttpStep;

export interface Workflow {
  id: string;
  name: string;
  /** Executed snapshots of either protocol. */
  steps: Draft[];
  activeStepId: string | null;
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
    protocol: "grpc",
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
    streamId: null,
  };
}

export function newWorkflow(name: string): Workflow {
  return { id: newId(), name, steps: [], activeStepId: null, envName: null };
}
