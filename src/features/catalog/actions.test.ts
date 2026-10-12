import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/ipc/client", () => ({
  envActiveSet: vi.fn(),
}));

import { workflowStore } from "@/features/workflow/store";
import { newStep } from "@/features/workflow/model";
import { newHttpStep } from "@/features/http/model";
import { openSavedRequest, newRequestDraft, newHttpRequestDraft } from "./actions";
import type { HttpResponseIpc, HttpTemplateIpc, InvokeOutcomeIpc, SavedRequestIpc } from "@/ipc/bindings";

const outcome = { status_code: 0 } as unknown as InvokeOutcomeIpc;
const response: HttpResponseIpc = {
  status: 201, reason: "Created", headers: [], body: { type: "empty" }, size_bytes: 0, elapsed_ms: 12,
};

const saved: SavedRequestIpc = {
  id: "r1",
  name: "Get",
  template: { protocol: "grpc", address_template: "h:1", service: "p.S", method: "Get", body_template: "{}", metadata: [], auth: { kind: "none" }, tls_override: false },
  last_used_at: null,
  use_count: 0,
};

beforeEach(() => {
  vi.clearAllMocks();
  workflowStore.reset();
});

describe("openSavedRequest", () => {
  const savedFull: SavedRequestIpc = {
    id: "req-1",
    name: "GetX",
    template: { protocol: "grpc", address_template: "{{host}}:443", service: "p.v1.S", method: "GetX", body_template: '{"id":"1"}', metadata: [{ key: "x", value: "y", enabled: true }], auth: { kind: "env_var", env_var: "TOK", header_name: "authorization", prefix: "Bearer " }, tls_override: true },
    last_used_at: null,
    use_count: 0,
  };

  it("loads a saved request into the draft and binds origin", () => {
    openSavedRequest("c1", savedFull);
    const { id: _draftId, ...draft } = workflowStore.getState().draft!;
    expect(draft).toEqual({
      protocol: "grpc",
      address: "{{host}}:443",
      tls: true,
      service: "p.v1.S",
      method: "GetX",
      auth: { kind: "env_var", env_var: "TOK", header_name: "authorization", prefix: "Bearer " },
      collectionId: "c1",
      requestJson: '{"id":"1"}',
      metadata: [{ key: "x", value: "y", enabled: true }],
      status: "draft",
      outcome: null,
      error: null,
      requestId: null,
      streamId: null,
    });
    expect(workflowStore.getState().draftOrigin).toEqual({
      collectionId: "c1", requestId: "req-1", requestName: "GetX",
    });
    expect(workflowStore.getState().draftDirty).toBe(false);
    expect(workflowStore.activeWorkflow().steps).toHaveLength(0);
  });

  it("seeds the draft's response from the session's last executed step", () => {
    workflowStore.commitExecutedStep({
      ...newStep({ address: "h:1", tls: false, service: "p.S", method: "Get" }),
      status: "ok",
      outcome,
    });
    openSavedRequest("c1", saved);
    expect(workflowStore.getState().draft).toMatchObject({ protocol: "grpc", status: "ok", outcome });
  });

  it("leaves a clean response when the session has no matching call", () => {
    openSavedRequest("c1", saved);
    expect(workflowStore.getState().draft).toMatchObject({
      protocol: "grpc", status: "draft", outcome: null,
    });
  });
});

describe("newRequestDraft", () => {
  it("sets an empty draft with no origin", () => {
    newRequestDraft();
    expect(workflowStore.getState().draft).toMatchObject({
      protocol: "grpc", status: "draft", address: "", service: "", method: "",
    });
    expect(workflowStore.getState().draftOrigin).toBeNull();
  });
});

describe("HTTP requests", () => {
  const template: HttpTemplateIpc = {
    method: "POST",
    url_template: "{{base}}/users",
    query: [{ key: "page", value: "2", enabled: true }],
    headers: [{ key: "accept", value: "application/json", enabled: true }],
    body: { kind: "json", text: '{"name":"a"}' },
    auth: { kind: "none" },
  };
  const savedHttp: SavedRequestIpc = {
    id: "h1",
    name: "POST users",
    template: { protocol: "http", ...template },
    last_used_at: null,
    use_count: 0,
  };

  it("opens a saved HTTP request as an HTTP draft bound to its origin", () => {
    openSavedRequest("c1", savedHttp);
    const { id: _draftId, ...draft } = workflowStore.getState().draft!;
    expect(draft).toEqual({ protocol: "http", collectionId: "c1", template, run: { status: "draft" } });
    expect(workflowStore.getState().draftOrigin).toEqual({
      collectionId: "c1", requestId: "h1", requestName: "POST users",
    });
    expect(workflowStore.getState().draftDirty).toBe(false);
  });

  it("seeds an HTTP draft's response from the last executed call to the same request", () => {
    const run = { status: "done", response, authUsed: { kind: "none" } } as const;
    workflowStore.commitExecutedStep({ ...newHttpStep({ template, collectionId: "c1" }), run });
    openSavedRequest("c1", savedHttp);
    expect(workflowStore.getState().draft).toMatchObject({ protocol: "http", run });
  });

  it("does not seed from a call whose query rows differ", () => {
    const run = { status: "done", response, authUsed: { kind: "none" } } as const;
    const other = { ...template, query: [{ key: "page", value: "3", enabled: true }] };
    workflowStore.commitExecutedStep({ ...newHttpStep({ template: other, collectionId: "c1" }), run });
    openSavedRequest("c1", savedHttp);
    expect(workflowStore.getState().draft).toMatchObject({ protocol: "http", run: { status: "draft" } });
  });

  it("starts a fresh HTTP draft with GET and an empty URL", () => {
    newHttpRequestDraft();
    const { id: _draftId, ...draft } = workflowStore.getState().draft!;
    expect(draft).toEqual({
      protocol: "http",
      collectionId: null,
      template: {
        method: "GET", url_template: "", query: [], headers: [], body: { kind: "none" }, auth: { kind: "none" },
      },
      run: { status: "draft" },
    });
    expect(workflowStore.getState().draftOrigin).toBeNull();
  });
});
