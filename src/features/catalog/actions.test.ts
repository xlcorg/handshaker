import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/ipc/client", () => ({
  grpcDescribe: vi.fn(),
  grpcRefreshContract: vi.fn(),
  grpcBuildRequestSkeleton: vi.fn(),
  grpcInvokeOneshot: vi.fn(),
  envActiveSet: vi.fn(),
}));

vi.mock("@/features/workflow/actions", () => ({
  createStepFromMethod: vi.fn(),
}));

import * as ipc from "@/ipc/client";
import { catalogStore } from "./store";
import { workflowStore } from "@/features/workflow/store";
import { createStepFromMethod } from "@/features/workflow/actions";
import { newStep } from "@/features/workflow/model";
import { describeService, refreshContract, openCallFromMethod, openSavedRequest, newRequestDraft } from "./actions";
import { savedRequestToDraft } from "./mapping";
import type { ServiceCatalogIpc, SavedRequestIpc } from "@/ipc/bindings";

const contract: ServiceCatalogIpc = {
  services: [{ full_name: "p.v1.S", methods: [] }],
};

beforeEach(() => {
  vi.clearAllMocks();
  catalogStore.reset();
  workflowStore.reset();
});

describe("describeService", () => {
  it("reflects with the service target and caches the contract", async () => {
    vi.mocked(ipc.grpcDescribe).mockResolvedValue(contract);
    const svc = catalogStore.addService({ address: "pay:443", tls: true, skipVerify: true });
    const out = await describeService(svc);
    expect(out).toBe(contract);
    expect(ipc.grpcDescribe).toHaveBeenCalledWith({ address: "pay:443", tls: true, skip_verify: true });
    expect(catalogStore.getService(svc.id)?.contract).toBe(contract);
    expect(catalogStore.getService(svc.id)?.contractFetchedAt).not.toBeNull();
  });
});

describe("refreshContract", () => {
  it("force-refreshes and caches", async () => {
    vi.mocked(ipc.grpcRefreshContract).mockResolvedValue(contract);
    const svc = catalogStore.addService({ address: "h:443" });
    await refreshContract(svc);
    expect(ipc.grpcRefreshContract).toHaveBeenCalledWith({ address: "h:443", tls: false, skip_verify: false });
    expect(catalogStore.getService(svc.id)?.contract).toBe(contract);
  });
});

describe("openCallFromMethod", () => {
  it("opens the method as the global draft, carrying the service auth inline", async () => {
    const step = newStep({ address: "ord:443", tls: true, service: "ord.v1.OrderService", method: "GetOrder" });
    vi.mocked(createStepFromMethod).mockResolvedValue(step);
    const setDraft = vi.spyOn(workflowStore, "setDraft");
    const svc = catalogStore.addService({ address: "ord:443", tls: true });
    await openCallFromMethod(svc, "ord.v1.OrderService", "GetOrder");
    expect(createStepFromMethod).toHaveBeenCalledWith(
      { address: svc.address, tls: svc.tls },
      "ord.v1.OrderService",
      "GetOrder",
      { auth: svc.auth, defaultMetadata: svc.defaultMetadata },
    );
    expect(setDraft).toHaveBeenCalledWith(step);
    expect(workflowStore.getState().draft).toBe(step);
    expect(workflowStore.activeWorkflow().view).toBe("focus");
    // draft path does not append to history
    expect(workflowStore.activeWorkflow().steps).toHaveLength(0);
  });

  it("opens in a fresh workflow when newWorkflow is set", async () => {
    const step = newStep({ address: "h:443", tls: false, service: "p.S", method: "M" });
    vi.mocked(createStepFromMethod).mockResolvedValue(step);
    const before = workflowStore.getState().workflows.length;
    const svc = catalogStore.addService({ address: "h:443" });
    await openCallFromMethod(svc, "p.S", "M", { newWorkflow: true });
    const st = workflowStore.getState();
    expect(st.workflows).toHaveLength(before + 1);
    expect(st.draft).toBe(step);
  });
});

describe("openSavedRequest", () => {
  it("loads a saved request into the global draft and switches to Focus", () => {
    const saved: SavedRequestIpc = {
      id: "req-1", name: "GetX", address_template: "{{host}}:443", service: "p.v1.S",
      method: "GetX", body_template: '{"id":"1"}',
      metadata: [{ key: "x", value: "y", enabled: true }],
      auth: { kind: "env_var", env_var: "TOK", header_name: "authorization", prefix: "Bearer " },
      tls_override: true, last_used_at: null, use_count: 0,
    };
    openSavedRequest(saved);
    const draft = workflowStore.getState().draft;
    const { id: _draftId, ...draftRest } = draft!;
    const { id: _expectedId, ...expectedRest } = savedRequestToDraft(saved);
    expect(draftRest).toEqual(expectedRest);
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
  });
});
