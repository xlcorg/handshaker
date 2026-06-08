/**
 * gRPC canonical status codes (https://grpc.github.io/grpc/core/md_doc_statuscodes.html).
 * `statusName(0)` → `"OK"`, `statusName(5)` → `"NOT_FOUND"`, etc.
 */
const NAMES: Record<number, string> = {
  0: "OK",
  1: "CANCELLED",
  2: "UNKNOWN",
  3: "INVALID_ARGUMENT",
  4: "DEADLINE_EXCEEDED",
  5: "NOT_FOUND",
  6: "ALREADY_EXISTS",
  7: "PERMISSION_DENIED",
  8: "RESOURCE_EXHAUSTED",
  9: "FAILED_PRECONDITION",
  10: "ABORTED",
  11: "OUT_OF_RANGE",
  12: "UNIMPLEMENTED",
  13: "INTERNAL",
  14: "UNAVAILABLE",
  15: "DATA_LOSS",
  16: "UNAUTHENTICATED",
};

export function statusName(code: number): string {
  return NAMES[code] ?? `CODE_${code}`;
}

/**
 * Short human description per canonical gRPC code (source as above). Used to give the
 * error view context beyond the bare code name.
 */
const DESCRIPTIONS: Record<number, string> = {
  0: "The call completed successfully.",
  1: "The operation was cancelled, typically by the caller.",
  2: "Unknown error — an error raised by an API that does not return enough status information.",
  3: "The client specified an invalid argument. Check the request fields.",
  4: "The deadline expired before the operation could complete.",
  5: "The requested entity was not found.",
  6: "The entity the client attempted to create already exists.",
  7: "The caller does not have permission to execute this operation.",
  8: "A resource has been exhausted — a quota, rate limit, or server capacity.",
  9: "The system is not in the required state for this operation (failed precondition).",
  10: "The operation was aborted, typically due to a concurrency conflict.",
  11: "The operation was attempted past the valid range.",
  12: "The operation is not implemented or not supported by this service.",
  13: "An internal server error occurred.",
  14: "The service is currently unavailable — usually transient. Retry with backoff.",
  15: "Unrecoverable data loss or corruption.",
  16: "The request lacks valid authentication credentials.",
};

export function statusDescription(code: number): string {
  return DESCRIPTIONS[code] ?? "Non-standard status code returned by the server.";
}

/**
 * JSON byte size formatted as `123B` / `1.2KB` / `3.4MB` (UTF-8 byte length).
 */
export function formatBytes(s: string | null | undefined): string {
  if (s == null) return "0B";
  const bytes = new TextEncoder().encode(s).length;
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}
