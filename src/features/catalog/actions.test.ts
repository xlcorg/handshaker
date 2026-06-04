import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/ipc/client", () => ({
  grpcDescribe: vi.fn(),
  grpcRefreshContract: vi.fn(),
  grpcBuildRequestSkeleton: vi.fn(),
  grpcInvokeOneshot: vi.fn(),
  envActiveSet: vi.fn(),
}));

import * as ipc from "@/ipc/client";
import { catalogStore } from "./store";
import { workflowStore } from "@/features/workflow/store";
import { describeService, refreshContract, openCallFromMethod } from "./actions";
import type { ServiceCatalogIpc } from "@/ipc/bindings";

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
  it("creates a step in the active workflow and switches to focus", async () => {
    vi.mocked(ipc.grpcBuildRequestSkeleton).mockResolvedValue('{"id":""}');
    const svc = catalogStore.addService({ address: "ord:443", tls: true });
    await openCallFromMethod(svc, "ord.v1.OrderService", "GetOrder");
    const wf = workflowStore.activeWorkflow();
    expect(wf.steps).toHaveLength(1);
    expect(wf.steps[0]).toMatchObject({
      address: "ord:443",
      tls: true,
      service: "ord.v1.OrderService",
      method: "GetOrder",
    });
    expect(wf.activeStepId).toBe(wf.steps[0].id);
    expect(wf.view).toBe("focus");
  });

  it("opens in a fresh workflow when newWorkflow is set", async () => {
    vi.mocked(ipc.grpcBuildRequestSkeleton).mockResolvedValue("{}");
    const before = workflowStore.getState().workflows.length;
    const svc = catalogStore.addService({ address: "h:443" });
    await openCallFromMethod(svc, "p.S", "M", { newWorkflow: true });
    const st = workflowStore.getState();
    expect(st.workflows).toHaveLength(before + 1);
    expect(workflowStore.activeWorkflow().steps).toHaveLength(1);
  });
});
