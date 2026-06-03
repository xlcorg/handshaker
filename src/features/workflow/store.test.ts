import { describe, it, expect, beforeEach } from "vitest";
import { workflowStore } from "./store";
import { newStep } from "./model";

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
