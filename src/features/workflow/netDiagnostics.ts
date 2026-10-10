import type { IpcError } from "@/ipc/bindings";
import type { MethodKind } from "@/lib/method-kind";
import { messages } from "@/lib/messages";

export const FAULT_KINDS = [
  "refused",
  "tls",
  "dns",
  "timeout",
  "cancelled",
  "encode",
  "decode",
  "auth",
  "kind_mismatch",
  "other",
] as const;

/** Display face selector for a client-side (non-gRPC-status) failure. */
export type FaultKind = (typeof FAULT_KINDS)[number];

/** A persisted fault kind (call history stores it as text). Unknown text reads as `other`. */
export function parseFaultKind(s: string): FaultKind {
  return (FAULT_KINDS as readonly string[]).includes(s) ? (s as FaultKind) : "other";
}

/** The kind gate's verdict: the call path (`expected`) did not match the contract's
 *  **Method kind** (`actual`) — nothing reached the wire. `actual` is the path a
 *  one-shot re-route takes. */
export interface KindMismatch {
  service: string;
  method: string;
  expected: MethodKind;
  actual: MethodKind;
}

export interface ClientFault {
  kind: FaultKind;
  /** Raw, human-readable message for the footer. */
  message: string;
  /** `kind_mismatch` only: both kinds, for the hint and the re-route. */
  mismatch?: KindMismatch;
}

/** A `kind_mismatch` fault with its verdict attached — what a refused Send / Open hands
 *  back to the call orchestrator (`useCall`) for the one-shot re-route. */
export type KindMismatchFault = ClientFault & { kind: "kind_mismatch"; mismatch: KindMismatch };

export function isKindMismatch(fault: ClientFault): fault is KindMismatchFault {
  return fault.kind === "kind_mismatch" && fault.mismatch !== undefined;
}

const HINT: Record<Exclude<FaultKind, "kind_mismatch">, string> = messages.workflow.fault.hint;

/** Actionable hint for a fault (empty string ⇒ no hint shown). Static per kind; for
 *  `kind_mismatch` it is the remedy only — the method and both kinds are in the message. */
export function faultHint(fault: ClientFault): string {
  if (fault.kind === "kind_mismatch") return messages.workflow.fault.kindMismatchHint;
  return HINT[fault.kind];
}

/** `(service, method, expected, actual)` with the kinds in human form. */
function mismatchWords(m: KindMismatch): [string, string, string, string] {
  const label = messages.methodKind.label;
  return [m.service, m.method, label[m.expected], label[m.actual]];
}

export function isObj(e: unknown): e is Record<string, unknown> {
  return typeof e === "object" && e !== null;
}

/** True only for the backend's structured cancel error — the safe cancel discriminator. */
export function isCancelError(e: unknown): boolean {
  return isObj(e) && e.type === "Cancelled";
}

function transportKindToFault(kind: string): FaultKind {
  switch (kind) {
    case "Refused":
      return "refused";
    case "Tls":
      return "tls";
    case "Dns":
      return "dns";
    default:
      return "other";
  }
}

function ipcErrorMessage(e: IpcError): string {
  if ("message" in e && typeof e.message === "string") return e.message;
  if ("hint" in e && typeof e.hint === "string") return e.hint;
  if ("name" in e && typeof e.name === "string") return messages.workflow.fault.unresolvedVariable(e.name);
  if ("chain" in e && Array.isArray(e.chain)) return messages.workflow.send.variableCycle(e.chain);
  return e.type;
}

/** The one mapping of a structured `IpcError` to a display fault — shared by the unary
 *  Send (`sendStep`) and the Stream call (pre-Open rejection and post-Open `Fault`), so
 *  every client-side failure wears the same face. No regex on messages. */
export function faultFromIpcError(e: IpcError): ClientFault {
  switch (e.type) {
    case "UnresolvedVars":
      return {
        kind: "other",
        message: e.cycle
          ? messages.workflow.send.variableCycle(e.cycle)
          : messages.workflow.send.unresolvedVariables(e.unresolved),
      };
    case "Transport":
      return { kind: transportKindToFault(e.kind), message: e.message };
    case "DeadlineExceeded":
      return { kind: "timeout", message: messages.workflow.fault.timedOut(e.timeout_ms) };
    case "Cancelled":
      return { kind: "cancelled", message: messages.workflow.fault.cancelled };
    case "EncodeRequest":
      return { kind: "encode", message: e.message };
    case "DecodeResponse":
      return { kind: "decode", message: e.message };
    case "Auth":
      return { kind: "auth", message: e.message };
    case "StreamMessageNotFound":
      // The store was released (or the row is stale) — the raw discriminator is no face.
      return { kind: "other", message: messages.workflow.fault.streamMessageNotFound };
    case "StreamClosed":
      // Send message / Half-close raced the stream's end (or ran after half-close).
      return { kind: "other", message: messages.workflow.fault.streamClosed };
    case "StreamNotFound":
      // Save messages / Assemble on a store that was released under the menu.
      return { kind: "other", message: messages.workflow.fault.streamNotFound };
    case "StreamFieldNotFound":
      // A stale Assemble candidate — the contract changed since Open.
      return { kind: "other", message: messages.workflow.fault.streamFieldNotFound };
    case "MethodKindMismatch": {
      // The kind gate: the path disagreed with the contract; `actual` drives the re-route.
      const mismatch: KindMismatch = { service: e.service, method: e.method, expected: e.expected, actual: e.actual };
      return { kind: "kind_mismatch", message: messages.workflow.fault.kindMismatch(...mismatchWords(mismatch)), mismatch };
    }
    default:
      return { kind: "other", message: ipcErrorMessage(e) };
  }
}

/** Map a thrown IPC error (or any throwable) to a display fault — no regex on messages. */
export function faultFromUnknown(e: unknown): ClientFault {
  if (isObj(e) && typeof e.type === "string") return faultFromIpcError(e as IpcError);
  return { kind: "other", message: e instanceof Error ? e.message : String(e) };
}
