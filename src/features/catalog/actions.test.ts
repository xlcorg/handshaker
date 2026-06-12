import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/ipc/client", () => ({
  envActiveSet: vi.fn(),
}));

import { workflowStore } from "@/features/workflow/store";
import { newStep } from "@/features/workflow/model";
import { openSavedRequest, newRequestDraft } from "./actions";
import { savedRequestToDraft } from "./mapping";
import type { InvokeOutcomeIpc, SavedRequestIpc } from "@/ipc/bindings";

const outcome = { status_code: 0 } as unknown as InvokeOutcomeIpc;

const saved: SavedRequestIpc = {
  id: "r1",
  name: "Get",
  address_template: "h:1",
  service: "p.S",
  method: "Get",
  body_template: "{}",
  metadata: [],
  auth: { kind: "none" },
  tls_override: false,
  last_used_at: null,
  use_count: 0,
};

beforeEach(() => {
  vi.clearAllMocks();
  workflowStore.reset();
});

describe("openSavedRequest", () => {
  const savedFull: SavedRequestIpc = {
    id: "req-1", name: "GetX", address_template: "{{host}}:443", service: "p.v1.S",
    method: "GetX", body_template: '{"id":"1"}',
    metadata: [{ key: "x", value: "y", enabled: true }],
    auth: { kind: "env_var", env_var: "TOK", header_name: "authorization", prefix: "Bearer " },
    tls_override: true, last_used_at: null, use_count: 0,
  };

  it("loads a saved request into the draft, binds origin, and switches to Focus", () => {
    openSavedRequest("c1", savedFull);
    const draft = workflowStore.getState().draft;
    // collectionId is stamped from the origin by the store (asserted separately below).
    const { id: _draftId, collectionId: _draftCol, ...draftRest } = draft!;
    const { id: _expectedId, collectionId: _expCol, ...expectedRest } =
      savedRequestToDraft(savedFull);
    expect(draftRest).toEqual(expectedRest);
    expect(draft!.collectionId).toBe("c1"); // stamped from origin
    expect(workflowStore.getState().draftOrigin).toEqual({
      collectionId: "c1", requestId: "req-1", requestName: "GetX",
    });
    expect(workflowStore.getState().draftDirty).toBe(false);
    expect(workflowStore.activeWorkflow().view).toBe("focus");
    expect(workflowStore.activeWorkflow().steps).toHaveLength(0);
  });

  it("seeds the draft's response from the session's last executed step", () => {
    workflowStore.commitExecutedStep({
      ...newStep({ address: "h:1", tls: false, service: "p.S", method: "Get" }),
      status: "ok",
      outcome,
    });
    openSavedRequest("c1", saved);
    const d = workflowStore.getState().draft!;
    expect(d.outcome).toEqual(outcome);
    expect(d.status).toBe("ok");
  });

  it("leaves a clean response when the session has no matching call", () => {
    openSavedRequest("c1", saved);
    const d = workflowStore.getState().draft!;
    expect(d.outcome).toBeNull();
    expect(d.status).toBe("draft");
  });
});

describe("newRequestDraft", () => {
  it("sets an empty draft and switches to Focus", () => {
    newRequestDraft();
    const draft = workflowStore.getState().draft;
    expect(draft?.status).toBe("draft");
    expect(draft?.address).toBe("");
    expect(draft?.service).toBe("");
    expect(draft?.method).toBe("");
    expect(workflowStore.activeWorkflow().view).toBe("focus");
    expect(workflowStore.getState().draftOrigin).toBeNull();
  });
});
