import { describe, it, expect } from "vitest";
import { stepToSavedRequest } from "./mapping";
import { newStep, type Step } from "@/features/workflow/model";

function step(over: Partial<Step> = {}): Step {
  return {
    ...newStep({ address: "localhost:5002", tls: false, service: "pkg.v1.Svc", method: "GetX" }),
    ...over,
  };
}

describe("stepToSavedRequest", () => {
  it("maps step fields onto a SavedRequestIpc with the given id and name", () => {
    const s = step({
      address: "{{host}}:443",
      tls: true,
      service: "pkg.v1.Svc",
      method: "GetX",
      requestJson: '{"id":"1"}',
      metadata: [{ key: "x-tenant", value: "acme", enabled: true }],
    });
    const saved = stepToSavedRequest(s, { id: "req-1", name: "GetX" });
    expect(saved).toEqual({
      id: "req-1",
      name: "GetX",
      address_template: "{{host}}:443",
      service: "pkg.v1.Svc",
      method: "GetX",
      body_template: '{"id":"1"}',
      metadata: [{ key: "x-tenant", value: "acme", enabled: true }],
      auth: { kind: "none" },
      tls_override: true,
      last_used_at: null,
      use_count: 0,
    });
  });

  it("copies metadata rows into a fresh array (no aliasing)", () => {
    const s = step({ metadata: [{ key: "a", value: "b", enabled: false }] });
    const saved = stepToSavedRequest(s, { id: "r", name: "n" });
    expect(saved.metadata).not.toBe(s.metadata);
    expect(saved.metadata).toEqual([{ key: "a", value: "b", enabled: false }]);
  });
});
