import { describe, it, expect } from "vitest";
import { faultFromUnknown, isCancelError, faultHint } from "./netDiagnostics";

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
    expect(faultHint("refused")).toMatch(/listening|server is running/i);
    expect(faultHint("other")).toBe("");
  });
});
