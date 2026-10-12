import { describe, it, expect } from "vitest";
import { draftFromTemplate, recordedTemplateOf, templateOf } from "./mapping";
import { newStep, type Step } from "@/features/workflow/model";
import { newHttpStep } from "@/features/http/model";
import { narrow } from "@/test/narrow";
import type { GrpcTemplateIpc, HttpTemplateIpc, RequestTemplateIpc } from "@/ipc/bindings";

function step(over: Partial<Step> = {}): Step {
  return {
    ...newStep({ address: "localhost:5002", tls: false, service: "pkg.v1.Svc", method: "GetX" }),
    ...over,
  };
}

describe("templateOf", () => {
  it("maps a step's authored fields onto a gRPC template", () => {
    const s = step({
      address: "{{host}}:443",
      tls: true,
      service: "pkg.v1.Svc",
      method: "GetX",
      requestJson: '{"id":"1"}',
      metadata: [{ key: "x-tenant", value: "acme", enabled: true }],
      auth: { kind: "env_var", env_var: "TOK", header_name: "authorization", prefix: "Bearer " },
    });
    expect(templateOf(s)).toEqual({
      protocol: "grpc",
      address_template: "{{host}}:443",
      tls_override: true,
      service: "pkg.v1.Svc",
      method: "GetX",
      body_template: '{"id":"1"}',
      metadata: [{ key: "x-tenant", value: "acme", enabled: true }],
      auth: { kind: "env_var", env_var: "TOK", header_name: "authorization", prefix: "Bearer " },
    });
  });

  it("keeps disabled and keyless metadata rows as authored, copied into a fresh array", () => {
    const rows = [
      { key: "a", value: "b", enabled: false },
      { key: "", value: "c", enabled: true },
    ];
    const s = step({ metadata: rows });
    const t = narrow(templateOf(s), "grpc");
    expect(t.metadata).not.toBe(rows);
    expect(t.metadata).toEqual([
      { key: "a", value: "b", enabled: false },
      { key: "", value: "c", enabled: true },
    ]);
  });

  it("passes the step's tri-state tls through to tls_override (bool and inherit)", () => {
    expect(templateOf(step({ tls: false }))).toMatchObject({ protocol: "grpc", tls_override: false });
    expect(templateOf(step({ tls: true }))).toMatchObject({ protocol: "grpc", tls_override: true });
    // null (inherit) must survive Save — else a request saved into a TLS collection freezes plaintext.
    expect(templateOf(step({ tls: null }))).toMatchObject({ protocol: "grpc", tls_override: null });
  });
});

const httpTemplate: HttpTemplateIpc = {
  method: "PATCH",
  url_template: "{{base}}/users/{{id}}",
  query: [{ key: "dry", value: "1", enabled: false }],
  headers: [{ key: "x-tenant", value: "acme", enabled: true }],
  body: { kind: "form", fields: [{ key: "name", value: "a", enabled: true }] },
  auth: { kind: "env_var", env_var: "TOK", header_name: "authorization", prefix: "Bearer " },
};

describe("HTTP templates", () => {
  it("saves an HTTP draft's template tagged with its protocol", () => {
    expect(templateOf(newHttpStep({ template: httpTemplate }))).toEqual({
      protocol: "http",
      method: "PATCH",
      url_template: "{{base}}/users/{{id}}",
      query: [{ key: "dry", value: "1", enabled: false }],
      headers: [{ key: "x-tenant", value: "acme", enabled: true }],
      body: { kind: "form", fields: [{ key: "name", value: "a", enabled: true }] },
      auth: { kind: "env_var", env_var: "TOK", header_name: "authorization", prefix: "Bearer " },
    });
  });

  it("opens an HTTP template as an HTTP draft, not a gRPC step", () => {
    const { id: _id, ...draft } = draftFromTemplate({ protocol: "http", ...httpTemplate }, "c1");
    expect(draft).toEqual({ protocol: "http", collectionId: "c1", template: httpTemplate, run: { status: "draft" } });
  });

  it("round-trips an HTTP request draft -> template -> draft", () => {
    const back = draftFromTemplate(templateOf(newHttpStep({ template: httpTemplate })), null);
    expect(back).toMatchObject({ protocol: "http", template: httpTemplate });
  });

  it("re-tags a recorded HTTP call's request as an HTTP template", () => {
    expect(
      recordedTemplateOf({
        protocol: "http",
        request: httpTemplate,
        outcome: { type: "fault", fault: { kind: "refused", message: "x" } },
      }),
    ).toEqual({ protocol: "http", ...httpTemplate });
  });
});

function template(over: Partial<GrpcTemplateIpc> = {}): Extract<RequestTemplateIpc, { protocol: "grpc" }> {
  return {
    protocol: "grpc",
    address_template: "localhost:5002",
    tls_override: null,
    service: "pkg.v1.Svc",
    method: "GetX",
    body_template: "{}",
    metadata: [],
    auth: { kind: "none" },
    ...over,
  };
}

describe("draftFromTemplate", () => {
  it("produces a draft-status Step carrying the template's call fields and the collection", () => {
    const draft = draftFromTemplate(
      template({
        address_template: "{{host}}:443",
        tls_override: true,
        body_template: '{"id":"1"}',
        metadata: [{ key: "x", value: "y", enabled: true }],
        auth: { kind: "env_var", env_var: "TOK", header_name: "authorization", prefix: "Bearer " },
      }),
      "c1",
    );
    expect(draft).toMatchObject({
      protocol: "grpc",
      status: "draft",
      address: "{{host}}:443",
      tls: true,
      service: "pkg.v1.Svc",
      method: "GetX",
      requestJson: '{"id":"1"}',
      metadata: [{ key: "x", value: "y", enabled: true }],
      auth: { kind: "env_var", env_var: "TOK", header_name: "authorization", prefix: "Bearer " },
      collectionId: "c1",
      outcome: null,
    });
  });

  it("preserves a null tls_override as inherit (not collapsed to false)", () => {
    expect(draftFromTemplate(template({ tls_override: null }), null)).toMatchObject({ protocol: "grpc", tls: null });
  });

  it("keeps an explicit false tls_override distinct from inherit", () => {
    expect(draftFromTemplate(template({ tls_override: false }), null)).toMatchObject({ protocol: "grpc", tls: false });
  });

  it("copies metadata into a fresh array, not aliasing the template", () => {
    const src = template({ metadata: [{ key: "a", value: "b", enabled: true }] });
    const draft = narrow(draftFromTemplate(src, null), "grpc");
    expect(draft.metadata).not.toBe(src.metadata);
    expect(draft.metadata).toEqual([{ key: "a", value: "b", enabled: true }]);
  });

  it("round-trips the call fields and inline auth step -> template -> draft", () => {
    const auth = { kind: "env_var" as const, env_var: "TOK", header_name: "authorization", prefix: "Bearer " };
    const original = step({
      address: "api:443",
      tls: true,
      service: "pkg.v1.Svc",
      method: "Ping",
      requestJson: '{"n":1}',
      metadata: [{ key: "k", value: "v", enabled: false }],
      auth,
    });
    expect(draftFromTemplate(templateOf(original), null)).toMatchObject({
      address: "api:443",
      tls: true,
      service: "pkg.v1.Svc",
      method: "Ping",
      requestJson: '{"n":1}',
      metadata: [{ key: "k", value: "v", enabled: false }],
      auth,
    });
  });
});

describe("recordedTemplateOf", () => {
  it("re-tags a recorded call's request with its protocol", () => {
    const { protocol: _, ...request } = template({ method: "Ping" });
    expect(
      recordedTemplateOf({
        protocol: "grpc",
        request,
        outcome: { type: "unary_fault", fault: { kind: "refused", message: "x" } },
      }),
    ).toEqual(template({ method: "Ping" }));
  });
});
