import { describe, it, expect } from "vitest";
import { newWorkflow, newStep, type Workflow } from "./model";
import {
  addStep,
  updateStep,
  removeStep,
  setActiveStep,
  setView,
  reorderStep,
} from "./reducers";

function wfWith(...n: number[]): Workflow {
  let wf = newWorkflow("t");
  for (const i of n) {
    wf = addStep(wf, newStep({ address: "h", tls: true, service: "S", method: `M${i}` }));
  }
  return wf;
}

describe("addStep", () => {
  it("appends and makes the new step active", () => {
    const wf = wfWith(1, 2);
    expect(wf.steps.map((s) => s.method)).toEqual(["M1", "M2"]);
    expect(wf.activeStepId).toBe(wf.steps[1].id);
  });
});

describe("updateStep", () => {
  it("patches one step immutably, leaves others", () => {
    const wf = wfWith(1, 2);
    const id = wf.steps[0].id;
    const next = updateStep(wf, id, { requestJson: "{\"a\":1}" });
    expect(next.steps[0].requestJson).toBe("{\"a\":1}");
    expect(next.steps[1]).toBe(wf.steps[1]); // untouched reference
    expect(next).not.toBe(wf);
  });
  it("ignores unknown id", () => {
    const wf = wfWith(1);
    expect(updateStep(wf, "nope", { error: "x" }).steps[0].error).toBeNull();
  });
});

describe("removeStep", () => {
  it("reselects the previous step when the active step is removed", () => {
    const wf = wfWith(1, 2, 3); // active = M3
    const next = removeStep(wf, wf.steps[2].id);
    expect(next.steps.map((s) => s.method)).toEqual(["M1", "M2"]);
    expect(next.activeStepId).toBe(next.steps[1].id); // reselects M2
  });
  it("leaves active unchanged when a non-active step is removed", () => {
    const wf = wfWith(1, 2, 3); // active = M3
    const activeId = wf.activeStepId;
    const next = removeStep(wf, wf.steps[0].id); // remove M1
    expect(next.steps.map((s) => s.method)).toEqual(["M2", "M3"]);
    expect(next.activeStepId).toBe(activeId); // still M3
  });
  it("clears active when the last step is removed", () => {
    const wf = wfWith(1);
    const next = removeStep(wf, wf.steps[0].id);
    expect(next.steps).toEqual([]);
    expect(next.activeStepId).toBeNull();
  });
});

describe("reorderStep", () => {
  it("moves a step to a new index", () => {
    const wf = wfWith(1, 2, 3);
    const next = reorderStep(wf, 2, 0);
    expect(next.steps.map((s) => s.method)).toEqual(["M3", "M1", "M2"]);
  });
});

describe("setActiveStep / setView", () => {
  it("sets active id and view", () => {
    const wf = wfWith(1, 2);
    expect(setActiveStep(wf, wf.steps[0].id).activeStepId).toBe(wf.steps[0].id);
    expect(setView(wf, "ledger").view).toBe("ledger");
  });
});
