import { describe, it, expect } from "vitest";
import { stepToSavedRequest, savedRequestToDraft } from "./mapping";
import { newStep, type Step } from "@/features/workflow/model";
import type { SavedRequestIpc } from "@/ipc/bindings";

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

  it("writes a concrete tls_override for a plaintext step (never null on Save)", () => {
    const saved = stepToSavedRequest(step({ tls: false }), { id: "r", name: "n" });
    expect(saved.tls_override).toBe(false);
  });
});

function saved(over: Partial<SavedRequestIpc> = {}): SavedRequestIpc {
  return {
    id: "req-1",
    name: "GetX",
    address_template: "localhost:5002",
    service: "pkg.v1.Svc",
    method: "GetX",
    body_template: "{}",
    metadata: [],
    auth: { kind: "none" },
    tls_override: null,
    last_used_at: null,
    use_count: 0,
    ...over,
  };
}

describe("savedRequestToDraft", () => {
  it("produces a draft-status Step carrying the saved request's call fields", () => {
    const draft = savedRequestToDraft(
      saved({
        address_template: "{{host}}:443",
        tls_override: true,
        body_template: '{"id":"1"}',
        metadata: [{ key: "x", value: "y", enabled: true }],
      }),
    );
    expect(draft.status).toBe("draft");
    expect(draft.serviceId).toBeNull();
    expect(draft.address).toBe("{{host}}:443");
    expect(draft.tls).toBe(true);
    expect(draft.service).toBe("pkg.v1.Svc");
    expect(draft.method).toBe("GetX");
    expect(draft.requestJson).toBe('{"id":"1"}');
    expect(draft.metadata).toEqual([{ key: "x", value: "y", enabled: true }]);
  });

  it("treats a null tls_override as plaintext (false)", () => {
    expect(savedRequestToDraft(saved({ tls_override: null })).tls).toBe(false);
  });

  it("copies metadata into a fresh array, not aliasing the saved request", () => {
    const src = saved({ metadata: [{ key: "a", value: "b", enabled: true }] });
    const draft = savedRequestToDraft(src);
    expect(draft.metadata).not.toBe(src.metadata);
    expect(draft.metadata).toEqual([{ key: "a", value: "b", enabled: true }]);
  });

  it("round-trips the call fields step -> saved -> draft (auth/id aside)", () => {
    const original = step({
      address: "api:443",
      tls: true,
      service: "pkg.v1.Svc",
      method: "Ping",
      requestJson: '{"n":1}',
      metadata: [{ key: "k", value: "v", enabled: false }],
    });
    const draft = savedRequestToDraft(stepToSavedRequest(original, { id: "x", name: "Ping" }));
    expect(draft.address).toBe(original.address);
    expect(draft.tls).toBe(original.tls);
    expect(draft.service).toBe(original.service);
    expect(draft.method).toBe(original.method);
    expect(draft.requestJson).toBe(original.requestJson);
    expect(draft.metadata).toEqual(original.metadata);
  });
});
