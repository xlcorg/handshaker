import { describe, it, expect } from "vitest";
import { newWorkflow, newStep, type Workflow } from "./model";
import { addStep, updateStep, removeStep, setWorkflowEnv } from "./reducers";
import { newHttpStep } from "@/features/http/model";
import { narrow } from "@/test/narrow";

function wfWith(...n: number[]): Workflow {
  let wf = newWorkflow("t");
  for (const i of n) {
    wf = addStep(wf, newStep({ address: "h", tls: true, service: "S", method: `M${i}` }));
  }
  return wf;
}

const methods = (wf: Workflow) => wf.steps.map((s) => narrow(s, "grpc").method);

describe("addStep", () => {
  it("appends and makes the new step active", () => {
    const wf = wfWith(1, 2);
    expect(methods(wf)).toEqual(["M1", "M2"]);
    expect(wf.activeStepId).toBe(wf.steps[1].id);
  });
});

describe("updateStep", () => {
  it("patches one step immutably, leaves others", () => {
    const wf = wfWith(1, 2);
    const id = wf.steps[0].id;
    const next = updateStep(wf, id, { requestJson: "{\"a\":1}" });
    expect(narrow(next.steps[0], "grpc").requestJson).toBe("{\"a\":1}");
    expect(next.steps[1]).toBe(wf.steps[1]); // untouched reference
    expect(next).not.toBe(wf);
  });
  it("ignores unknown id", () => {
    const wf = wfWith(1);
    expect(narrow(updateStep(wf, "nope", { error: { kind: "other", message: "x" } }).steps[0], "grpc").error).toBeNull();
  });
  it("leaves an HTTP step untouched, since a gRPC patch has no meaning for it", () => {
    const http = newHttpStep();
    const wf = addStep(newWorkflow("t"), http);
    expect(updateStep(wf, http.id, { status: "ok" }).steps[0]).toBe(http);
  });
});

describe("removeStep", () => {
  it("reselects the previous step when the active step is removed", () => {
    const wf = wfWith(1, 2, 3); // active = M3
    const next = removeStep(wf, wf.steps[2].id);
    expect(methods(next)).toEqual(["M1", "M2"]);
    expect(next.activeStepId).toBe(next.steps[1].id); // reselects M2
  });
  it("leaves active unchanged when a non-active step is removed", () => {
    const wf = wfWith(1, 2, 3); // active = M3
    const activeId = wf.activeStepId;
    const next = removeStep(wf, wf.steps[0].id); // remove M1
    expect(methods(next)).toEqual(["M2", "M3"]);
    expect(next.activeStepId).toBe(activeId); // still M3
  });
  it("clears active when the last step is removed", () => {
    const wf = wfWith(1);
    const next = removeStep(wf, wf.steps[0].id);
    expect(next.steps).toEqual([]);
    expect(next.activeStepId).toBeNull();
  });
});

describe("setWorkflowEnv", () => {
  it("sets the workflow env name", () => {
    const wf = newWorkflow("wf");
    expect(setWorkflowEnv(wf, "staging").envName).toBe("staging");
  });
  it("clears env when given null", () => {
    const wf = { ...newWorkflow("wf"), envName: "prod" };
    expect(setWorkflowEnv(wf, null).envName).toBeNull();
  });
});
