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

/** Raw byte count formatted as `123B` / `1.2KB` / `3.4MB`. */
export function formatByteCount(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "0B";
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

/**
 * JSON byte size formatted as `123B` / `1.2KB` / `3.4MB` (UTF-8 byte length).
 */
export function formatBytes(s: string | null | undefined): string {
  if (s == null) return "0B";
  return formatByteCount(new TextEncoder().encode(s).length);
}
