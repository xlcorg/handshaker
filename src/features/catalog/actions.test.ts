import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/ipc/client", () => ({
  envActiveSet: vi.fn(),
}));

import { workflowStore } from "@/features/workflow/store";
import { openSavedRequest, newRequestDraft } from "./actions";
import { savedRequestToDraft } from "./mapping";
import type { SavedRequestIpc } from "@/ipc/bindings";

beforeEach(() => {
  vi.clearAllMocks();
  workflowStore.reset();
});

describe("openSavedRequest", () => {
  const saved: SavedRequestIpc = {
    id: "req-1", name: "GetX", address_template: "{{host}}:443", service: "p.v1.S",
    method: "GetX", body_template: '{"id":"1"}',
    metadata: [{ key: "x", value: "y", enabled: true }],
    auth: { kind: "env_var", env_var: "TOK", header_name: "authorization", prefix: "Bearer " },
    tls_override: true, last_used_at: null, use_count: 0,
  };

  it("loads a saved request into the draft, binds origin, and switches to Focus", () => {
    openSavedRequest("c1", saved);
    const draft = workflowStore.getState().draft;
    const { id: _draftId, ...draftRest } = draft!;
    const { id: _expectedId, ...expectedRest } = savedRequestToDraft(saved);
    expect(draftRest).toEqual(expectedRest);
    expect(workflowStore.getState().draftOrigin).toEqual({ collectionId: "c1", requestId: "req-1" });
    expect(workflowStore.getState().draftDirty).toBe(false);
    expect(workflowStore.activeWorkflow().view).toBe("focus");
    expect(workflowStore.activeWorkflow().steps).toHaveLength(0);
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
