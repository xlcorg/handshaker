export type TransportKind = "refused" | "tls" | "dns" | "timeout" | "cancelled" | "other";

/**
 * Exact backend cancel sentinel (`IpcError::Transport { message }` fired by the cancel
 * `Notify`; see `grpc.rs` CANCELLED_MSG). Use this for the cancel CONTROL-FLOW decision
 * (reset to idle) — an exact match, not the fuzzy `/cancel/i` rule below, so an unrelated
 * transport error that merely contains "cancel" is never mistaken for a user cancel.
 */
export const CANCELLED_SENTINEL = "request cancelled";

/** True only for the exact backend cancel sentinel — the safe cancel discriminator. */
export function isCancelSentinel(message: string): boolean {
  return message === CANCELLED_SENTINEL;
}

export interface TransportDiagnosis {
  kind: TransportKind;
  hint: string;
}

const RULES: { kind: Exclude<TransportKind, "other">; patterns: RegExp; hint: string }[] = [
  { kind: "cancelled", patterns: /cancel/i, hint: "Request was cancelled." },
  { kind: "timeout", patterns: /timed out|timeout|deadline/i, hint: "The server did not respond before the request deadline. Raise it in Settings → Network or check the server." },
  { kind: "refused", patterns: /connection refused|econnrefused|refused/i, hint: "Nothing is listening at that address/port. Check the host, port, and that the server is running." },
  { kind: "tls", patterns: /certificate|tls|ssl|handshake/i, hint: "TLS negotiation failed. Verify the scheme, the server certificate, or disable verification for self-signed certs." },
  { kind: "dns", patterns: /\bdns\b|name resolution|failed to lookup|no such host/i, hint: "The hostname could not be resolved. Check the address for typos or your network/DNS." },
];

/** Map a raw client/transport error message to a friendly kind + actionable hint. */
export function classifyTransportError(message: string): TransportDiagnosis {
  for (const r of RULES) {
    if (r.patterns.test(message)) return { kind: r.kind, hint: r.hint };
  }
  return { kind: "other", hint: "" };
}
