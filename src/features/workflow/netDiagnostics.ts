export type TransportKind = "refused" | "tls" | "dns" | "timeout" | "cancelled" | "other";

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
