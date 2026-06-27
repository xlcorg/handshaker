import type { IpcError } from "@/ipc/bindings";

/** Display face selector for a client-side (non-gRPC-status) failure. */
export type FaultKind =
  | "refused"
  | "tls"
  | "dns"
  | "timeout"
  | "cancelled"
  | "encode"
  | "decode"
  | "auth"
  | "other";

export interface ClientFault {
  kind: FaultKind;
  /** Raw, human-readable message for the footer. */
  message: string;
}

const HINT: Record<FaultKind, string> = {
  refused:
    "Nothing is listening at that address/port. Check the host, port, and that the server is running.",
  tls: "TLS negotiation failed. Verify the scheme, the server certificate, or disable verification for self-signed certs.",
  dns: "The hostname could not be resolved. Check the address for typos or your network/DNS.",
  timeout:
    "The server did not respond before the request deadline. Raise it in Settings → Network or check the server.",
  cancelled: "Request was cancelled.",
  encode: "The request body could not be encoded for this method. Check the JSON against the contract.",
  decode:
    "The server's response could not be decoded — the method's contract may be stale. Refresh reflection.",
  auth: "Authentication could not be prepared. Check the auth configuration and its variables.",
  other: "",
};

/** Actionable hint for a fault kind (empty string ⇒ no hint shown). */
export function faultHint(kind: FaultKind): string {
  return HINT[kind];
}

function isObj(e: unknown): e is Record<string, unknown> {
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
  if ("name" in e && typeof e.name === "string") return `Unresolved variable: ${e.name}`;
  if ("chain" in e && Array.isArray(e.chain)) return `Variable cycle: ${e.chain.join(" → ")}`;
  return e.type;
}

function faultFromIpcError(e: IpcError): ClientFault {
  switch (e.type) {
    case "Transport":
      return { kind: transportKindToFault(e.kind), message: e.message };
    case "DeadlineExceeded":
      return { kind: "timeout", message: `Request timed out after ${e.timeout_ms}ms` };
    case "Cancelled":
      return { kind: "cancelled", message: "Request cancelled" };
    case "EncodeRequest":
      return { kind: "encode", message: e.message };
    case "DecodeResponse":
      return { kind: "decode", message: e.message };
    case "Auth":
      return { kind: "auth", message: e.message };
    default:
      return { kind: "other", message: ipcErrorMessage(e) };
  }
}

/** Map a thrown IPC error (or any throwable) to a display fault — no regex on messages. */
export function faultFromUnknown(e: unknown): ClientFault {
  if (isObj(e) && typeof e.type === "string") return faultFromIpcError(e as IpcError);
  return { kind: "other", message: e instanceof Error ? e.message : String(e) };
}
