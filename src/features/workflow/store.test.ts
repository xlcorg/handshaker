import { describe, it, expect, beforeEach, vi } from "vitest";
import { workflowStore } from "./store";
import { newStep } from "./model";

const envActiveSet = vi.fn().mockResolvedValue(undefined);
vi.mock("@/ipc/client", () => ({ envActiveSet: (n: string | null) => envActiveSet(n) }));

beforeEach(() => workflowStore.reset());

describe("workflowStore", () => {
  it("starts with one empty workflow that is active", () => {
    const s = workflowStore.getState();
    expect(s.workflows).toHaveLength(1);
    expect(s.activeWorkflowId).toBe(s.workflows[0].id);
  });

  it("applies a transition to the active workflow and notifies subscribers", () => {
    let calls = 0;
    const unsub = workflowStore.subscribe(() => calls++);
    const step = newStep({ address: "h", tls: true, service: "S", method: "M" });
    workflowStore.update((wf) => ({ ...wf, steps: [...wf.steps, step] }));
    expect(calls).toBe(1);
    expect(workflowStore.activeWorkflow().steps).toHaveLength(1);
    unsub();
  });

  it("createWorkflow adds and activates a new workflow", () => {
    const wf = workflowStore.createWorkflow("second");
    expect(workflowStore.getState().activeWorkflowId).toBe(wf.id);
    expect(workflowStore.getState().workflows).toHaveLength(2);
  });
});

describe("workflow env sync", () => {
  beforeEach(() => { workflowStore.reset(); envActiveSet.mockClear(); });

  it("setWorkflowEnv updates active workflow and pushes to backend", () => {
    workflowStore.setWorkflowEnv("prod");
    expect(workflowStore.activeWorkflow().envName).toBe("prod");
    expect(envActiveSet).toHaveBeenCalledWith("prod");
  });

  it("createWorkflow syncs backend to the new workflow's env (null)", () => {
    workflowStore.setWorkflowEnv("prod"); // current wf → prod, backend = prod
    envActiveSet.mockClear();
    workflowStore.createWorkflow("wf-2"); // new active wf has envName null
    expect(envActiveSet).toHaveBeenLastCalledWith(null);
  });

  it("switching workflows re-syncs backend to that workflow's env", () => {
    workflowStore.setWorkflowEnv("prod");            // current wf → prod
    const wf2 = workflowStore.createWorkflow("wf-2"); // new wf (envName null) becomes active
    envActiveSet.mockClear();
    workflowStore.setActiveWorkflow(
      workflowStore.getState().workflows[0].id,       // back to first wf
    );
    expect(envActiveSet).toHaveBeenLastCalledWith("prod");
    expect(wf2.envName).toBeNull();
  });
});
