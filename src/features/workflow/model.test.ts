import { describe, it, expect } from "vitest";
import { newStep, newWorkflow } from "./model";

describe("newStep", () => {
  it("creates a draft step with defaults and a unique id", () => {
    const a = newStep({ address: "h:443", tls: true, service: "p.S", method: "M" });
    const b = newStep({ address: "h:443", tls: true, service: "p.S", method: "M" });
    expect(a.id).not.toEqual(b.id);
    expect(a.status).toBe("draft");
    expect(a.outcome).toBeNull();
    expect(a.error).toBeNull();
    expect(a.requestJson).toBe("{}");
    expect(a.metadata).toEqual([]);
    expect(a.service).toBe("p.S");
    expect(a.method).toBe("M");
  });
});

describe("newStep — serviceId and metadata", () => {
  it("newStep defaults serviceId to null and metadata to []", () => {
    const s = newStep({ address: "h", tls: false, service: "S", method: "M" });
    expect(s.serviceId).toBeNull();
    expect(s.metadata).toEqual([]);
  });

  it("newStep carries provided serviceId and metadata", () => {
    const rows = [{ key: "x", value: "1", enabled: true }];
    const s = newStep({ address: "h", tls: false, service: "S", method: "M", serviceId: "svc-1", metadata: rows });
    expect(s.serviceId).toBe("svc-1");
    expect(s.metadata).toEqual(rows);
  });
});

describe("newWorkflow", () => {
  it("creates a workflow with no steps, focus view, no active step", () => {
    const wf = newWorkflow("incident");
    expect(wf.name).toBe("incident");
    expect(wf.steps).toEqual([]);
    expect(wf.activeStepId).toBeNull();
    expect(wf.view).toBe("focus");
    expect(wf.id).toMatch(/.+/);
  });

  it("newWorkflow defaults envName to null (No environment)", () => {
    expect(newWorkflow("wf-1").envName).toBeNull();
  });
});
