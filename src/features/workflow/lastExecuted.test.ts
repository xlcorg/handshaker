import { describe, it, expect } from "vitest";
import { newStep, type Step } from "./model";
import { lastExecutedFor, responseSeedPatch } from "./lastExecuted";
import type { InvokeOutcomeIpc } from "@/ipc/bindings";

const outcome = (code: number) =>
  ({ status_code: code } as unknown as InvokeOutcomeIpc);

function executed(service: string, method: string, address: string, code: number): Step {
  return {
    ...newStep({ address, tls: false, service, method }),
    status: code === 0 ? "ok" : "error",
    outcome: outcome(code),
  };
}

describe("lastExecutedFor", () => {
  const steps = [
    executed("p.S", "Get", "h:1", 0),
    executed("p.S", "List", "h:1", 0),
    executed("p.S", "Get", "h:1", 5), // более поздний вызов того же метода
    executed("p.S", "Get", "h:2", 0), // другой адрес
  ];

  it("returns the LATEST matching executed step", () => {
    const hit = lastExecutedFor(steps, { service: "p.S", method: "Get", address: "h:1" });
    expect(hit?.outcome).toEqual(outcome(5));
  });

  it("matches address too", () => {
    const hit = lastExecutedFor(steps, { service: "p.S", method: "Get", address: "h:2" });
    expect(hit?.outcome).toEqual(outcome(0));
  });

  it("returns null when nothing matches", () => {
    expect(lastExecutedFor(steps, { service: "p.S", method: "Nope", address: "h:1" })).toBeNull();
  });
});

describe("responseSeedPatch", () => {
  it("copies status/outcome/error from the hit", () => {
    const hit = executed("p.S", "Get", "h:1", 5);
    expect(responseSeedPatch(hit)).toEqual({ status: "error", outcome: outcome(5), error: null });
  });

  it("null hit clears the response fields", () => {
    expect(responseSeedPatch(null)).toEqual({ status: "draft", outcome: null, error: null });
  });
});
