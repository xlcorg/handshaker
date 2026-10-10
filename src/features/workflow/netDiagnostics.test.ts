import { describe, it, expect } from "vitest";
import { faultFromIpcError, faultFromUnknown, isCancelError, faultHint, parseFaultKind } from "./netDiagnostics";
import { messages } from "@/lib/messages";

describe("faultFromIpcError", () => {
  it("maps UnresolvedVars to the unary 'other' fault listing the vars", () => {
    expect(faultFromIpcError({ type: "UnresolvedVars", unresolved: ["host", "uid"], cycle: null })).toEqual({
      kind: "other",
      message: "Unresolved variables: {{host}}, {{uid}}",
    });
  });

  it("prefers the cycle message when UnresolvedVars carries a cycle", () => {
    expect(faultFromIpcError({ type: "UnresolvedVars", unresolved: [], cycle: ["a", "b", "a"] })).toEqual({
      kind: "other",
      message: "Variable cycle: a → b → a",
    });
  });

  it("maps DeadlineExceeded / Cancelled / Transport to their kinds", () => {
    expect(faultFromIpcError({ type: "DeadlineExceeded", timeout_ms: 30000 })).toEqual({
      kind: "timeout",
      message: "Request timed out after 30000ms",
    });
    expect(faultFromIpcError({ type: "Cancelled" })).toEqual({ kind: "cancelled", message: "Request cancelled" });
    expect(faultFromIpcError({ type: "Transport", kind: "Refused", message: "refused" }).kind).toBe("refused");
  });

  it("maps StreamMessageNotFound to a user-facing message, never the raw discriminator", () => {
    const f = faultFromIpcError({ type: "StreamMessageNotFound", request_id: "s1", index: 3 });
    expect(f.kind).toBe("other");
    expect(f.message).toBe(messages.workflow.fault.streamMessageNotFound);
    expect(f.message).not.toContain("StreamMessageNotFound");
  });

  it("maps StreamClosed (Send message / Half-close on a call that is not open) to a user-facing message", () => {
    const f = faultFromIpcError({ type: "StreamClosed", request_id: "s1" });
    expect(f.kind).toBe("other");
    expect(f.message).toBe(messages.workflow.fault.streamClosed);
    expect(f.message).not.toContain("StreamClosed");
  });

  it("maps MethodKindMismatch to kind_mismatch, keeping both kinds for the re-route and the hint", () => {
    const f = faultFromIpcError({ type: "MethodKindMismatch", service: "pkg.Svc", method: "Watch", expected: "unary", actual: "server" });
    expect(f.kind).toBe("kind_mismatch");
    expect(f.mismatch).toEqual({ service: "pkg.Svc", method: "Watch", expected: "unary", actual: "server" });
    expect(f.message).toContain("pkg.Svc/Watch");
    expect(f.message).not.toContain("MethodKindMismatch");
  });

  it("falls back to the type tag / message for the remaining variants", () => {
    expect(faultFromIpcError({ type: "NotConnected" })).toEqual({ kind: "other", message: "NotConnected" });
    expect(faultFromIpcError({ type: "MethodNotFound", service: "s", method: "m" }).kind).toBe("other");
  });
});

describe("faultFromUnknown", () => {
  it("maps a structured Transport error to its kind", () => {
    expect(faultFromUnknown({ type: "Transport", kind: "Refused", message: "refused" })).toEqual({
      kind: "refused",
      message: "refused",
    });
    expect(faultFromUnknown({ type: "Transport", kind: "Tls", message: "bad cert" }).kind).toBe("tls");
    expect(faultFromUnknown({ type: "Transport", kind: "Dns", message: "no host" }).kind).toBe("dns");
    expect(faultFromUnknown({ type: "Transport", kind: "Other", message: "weird" }).kind).toBe("other");
  });

  it("maps DeadlineExceeded to a timeout fault with the timeout in the message", () => {
    const f = faultFromUnknown({ type: "DeadlineExceeded", timeout_ms: 30000 });
    expect(f.kind).toBe("timeout");
    expect(f.message).toMatch(/30000/);
  });

  it("maps EncodeRequest / DecodeResponse / Auth", () => {
    expect(faultFromUnknown({ type: "EncodeRequest", message: "bad json" }).kind).toBe("encode");
    expect(faultFromUnknown({ type: "DecodeResponse", message: "bad proto" }).kind).toBe("decode");
    expect(faultFromUnknown({ type: "Auth", message: "no creds" }).kind).toBe("auth");
  });

  it("falls back to 'other' for unknown throwables", () => {
    expect(faultFromUnknown(new Error("boom"))).toEqual({ kind: "other", message: "boom" });
    expect(faultFromUnknown("plain string").kind).toBe("other");
  });

  it("formats a VariableCycle chain in the fallback message", () => {
    expect(faultFromUnknown({ type: "VariableCycle", chain: ["a", "b", "a"] })).toEqual({
      kind: "other",
      message: "Variable cycle: a → b → a",
    });
  });
});

describe("isCancelError", () => {
  it("is true only for the structured Cancelled error", () => {
    expect(isCancelError({ type: "Cancelled" })).toBe(true);
    expect(isCancelError({ type: "Transport", kind: "Other", message: "x" })).toBe(false);
    expect(isCancelError("request cancelled")).toBe(false);
  });
});

describe("faultHint", () => {
  it("returns a non-empty hint for known kinds and empty for other", () => {
    expect(faultHint({ kind: "refused", message: "" })).toMatch(/listening|server is running/i);
    expect(faultHint({ kind: "other", message: "" })).toBe("");
  });

  it("kind_mismatch: the message names the method and both kinds in human form; the hint is the remedy only", () => {
    const fault = faultFromIpcError({ type: "MethodKindMismatch", service: "pkg.Svc", method: "Watch", expected: "unary", actual: "server" });
    expect(fault.message).toContain("pkg.Svc/Watch");
    expect(fault.message).toContain("server-streaming");
    expect(fault.message).toContain("unary");
    const hint = faultHint(fault);
    expect(hint).toMatch(/refresh reflection/i);
    // Not the message again: the face would show the same sentence twice.
    expect(hint).not.toContain("pkg.Svc/Watch");
    expect(hint).not.toContain("but was called as");
    // Every kind has a human label.
    const bidi = faultFromIpcError({ type: "MethodKindMismatch", service: "s", method: "m", expected: "client", actual: "bidi" });
    expect(bidi.message).toContain("bidirectional");
    expect(bidi.message).toContain("client-streaming");
  });
});

describe("parseFaultKind", () => {
  it("keeps a known kind and reads unknown text as other", () => {
    expect(parseFaultKind("timeout")).toBe("timeout");
    expect(parseFaultKind("kind_mismatch")).toBe("kind_mismatch");
    expect(parseFaultKind("Timeout")).toBe("other");
    expect(parseFaultKind("")).toBe("other");
  });
});
