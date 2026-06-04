import { describe, it, expect } from "vitest";
import { classifyTransportError } from "./netDiagnostics";

describe("classifyTransportError", () => {
  it.each([
    ["request cancelled", "cancelled"],
    ["request timed out after 30000ms", "timeout"],
    ["deadline exceeded", "timeout"],
    ["connection refused", "refused"],
    ["ECONNREFUSED 127.0.0.1:443", "refused"],
    ["the certificate is not trusted", "tls"],
    ["TLS handshake failed", "tls"],
    ["dns error: failed to lookup address", "dns"],
    ["no such host", "dns"],
    ["something weird happened", "other"],
  ])("classifies %j as %s", (message, kind) => {
    expect(classifyTransportError(message).kind).toBe(kind);
  });

  it("returns a non-empty hint for recognised kinds and empty for other", () => {
    expect(classifyTransportError("connection refused").hint).toMatch(/listening|reachable|refused/i);
    expect(classifyTransportError("totally opaque").hint).toBe("");
  });

  it("is case-insensitive", () => {
    expect(classifyTransportError("Connection Refused").kind).toBe("refused");
  });
});
