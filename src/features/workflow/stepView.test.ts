import { describe, it, expect } from "vitest";
import { newStep } from "./model";
import { shortService, summarizeStep } from "./stepView";
import type { InvokeOutcomeIpc } from "@/ipc/bindings";

function outcome(code: number, ms = 12): InvokeOutcomeIpc {
  return {
    status_code: code,
    status_message: code === 0 ? "OK" : "ERR",
    response_json: "{}",
    trailing_metadata: {},
    elapsed_ms: ms,
  };
}

describe("shortService", () => {
  it("keeps only the last dotted segment", () => {
    expect(shortService("payments.v1.PaymentService")).toBe("PaymentService");
    expect(shortService("Health")).toBe("Health");
  });
});

describe("summarizeStep", () => {
  const base = { address: "h:443", tls: true, service: "p.v1.S", method: "Get" };

  it("uses a 1-based number and a short title", () => {
    const s = summarizeStep(newStep(base), 0);
    expect(s.number).toBe(1);
    expect(s.title).toBe("S · Get");
  });

  it("reports a pending draft", () => {
    const s = summarizeStep(newStep(base), 2);
    expect(s.number).toBe(3);
    expect(s.tone).toBe("pending");
    expect(s.statusText).toBe("draft");
    expect(s.elapsedMs).toBeNull();
  });

  it("reports a sending step", () => {
    const step = { ...newStep(base), status: "sending" as const };
    const s = summarizeStep(step, 0);
    expect(s.tone).toBe("pending");
    expect(s.statusText).toBe("…");
  });

  it("reports an OK outcome with code and elapsed", () => {
    const step = { ...newStep(base), status: "ok" as const, outcome: outcome(0, 53) };
    const s = summarizeStep(step, 0);
    expect(s.tone).toBe("ok");
    expect(s.statusText).toBe("✓ 0");
    expect(s.elapsedMs).toBe(53);
  });

  it("reports a non-OK gRPC outcome as error with its code", () => {
    const step = { ...newStep(base), status: "error" as const, outcome: outcome(5, 7) };
    const s = summarizeStep(step, 0);
    expect(s.tone).toBe("error");
    expect(s.statusText).toBe("✕ 5");
    expect(s.elapsedMs).toBe(7);
  });

  it("reports a client-side error (no outcome)", () => {
    const step = { ...newStep(base), status: "error" as const, error: "refused" };
    const s = summarizeStep(step, 0);
    expect(s.tone).toBe("error");
    expect(s.statusText).toBe("✕ error");
    expect(s.elapsedMs).toBeNull();
  });
});
