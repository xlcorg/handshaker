import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/ipc/client", () => ({
  envActiveSet: vi.fn().mockResolvedValue(undefined),
}));

import { workflowStore } from "./store";
import { isContentPatch } from "./store";
import { envActiveSet } from "@/ipc/client";
import { newStep } from "./model";
import { addStep, updateStep } from "./reducers";
import { newHttpStep } from "@/features/http/model";
import { narrow } from "@/test/narrow";
import type { HttpResponseIpc } from "@/ipc/bindings";

beforeEach(() => {
  vi.clearAllMocks();
  workflowStore.reset();
});

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
  beforeEach(() => { workflowStore.reset(); vi.mocked(envActiveSet).mockClear(); });

  it("setWorkflowEnv updates active workflow and pushes to backend", () => {
    workflowStore.setWorkflowEnv("prod");
    expect(workflowStore.activeWorkflow().envName).toBe("prod");
    expect(envActiveSet).toHaveBeenCalledWith("prod");
  });

  it("createWorkflow syncs backend to the new workflow's env (null)", () => {
    workflowStore.setWorkflowEnv("prod"); // current wf → prod, backend = prod
    vi.mocked(envActiveSet).mockClear();
    workflowStore.createWorkflow("wf-2"); // new active wf has envName null
    expect(envActiveSet).toHaveBeenLastCalledWith(null);
  });

  it("switching workflows re-syncs backend to that workflow's env", () => {
    workflowStore.setWorkflowEnv("prod");            // current wf → prod
    const wf2 = workflowStore.createWorkflow("wf-2"); // new wf (envName null) becomes active
    vi.mocked(envActiveSet).mockClear();
    workflowStore.setActiveWorkflow(
      workflowStore.getState().workflows[0].id,       // back to first wf
    );
    expect(envActiveSet).toHaveBeenLastCalledWith("prod");
    expect(wf2.envName).toBeNull();
  });
});

describe("parallel send independence", () => {
  beforeEach(() => { workflowStore.reset(); });

  it("two steps can be in-flight simultaneously with independent status + requestId", () => {
    // Add two steps via the addStep reducer (store has no direct addStep method)
    const stepA = newStep({ address: "h", tls: false, service: "S", method: "A" });
    const stepB = newStep({ address: "h", tls: false, service: "S", method: "B" });
    workflowStore.update((wf) => addStep(wf, stepA));
    workflowStore.update((wf) => addStep(wf, stepB));

    // Mark both as sending with distinct requestIds
    workflowStore.update((wf) => updateStep(wf, stepA.id, { status: "sending", requestId: "req-a" }));
    workflowStore.update((wf) => updateStep(wf, stepB.id, { status: "sending", requestId: "req-b" }));

    const steps = workflowStore.activeWorkflow().steps;
    expect(steps.find((s) => s.id === stepA.id)).toMatchObject({ status: "sending", requestId: "req-a" });
    expect(steps.find((s) => s.id === stepB.id)).toMatchObject({ status: "sending", requestId: "req-b" });

    // Completing A leaves B untouched.
    workflowStore.update((wf) => updateStep(wf, stepA.id, { status: "ok", requestId: null }));
    const stepsAfter = workflowStore.activeWorkflow().steps;
    expect(stepsAfter.find((s) => s.id === stepA.id)).toMatchObject({ status: "ok", requestId: null });
    expect(stepsAfter.find((s) => s.id === stepB.id)).toMatchObject({ status: "sending", requestId: "req-b" });
  });
});

describe("global pending-draft", () => {
  beforeEach(() => workflowStore.reset());

  it("starts with no draft", () => {
    expect(workflowStore.getState().draft).toBeNull();
  });

  it("setDraft stores a draft and notifies; clearDraft removes it", () => {
    let calls = 0;
    const unsub = workflowStore.subscribe(() => calls++);
    const d = newStep({ address: "h", tls: false, service: "S", method: "M" });
    workflowStore.setDraft(d);
    expect(workflowStore.getState().draft).toBe(d);
    workflowStore.clearDraft();
    expect(workflowStore.getState().draft).toBeNull();
    expect(calls).toBe(2);
    unsub();
  });

  it("updateGrpcDraft merges a patch onto the current draft", () => {
    workflowStore.setDraft(newStep({ address: "h", tls: false, service: "S", method: "M" }));
    workflowStore.updateGrpcDraft(workflowStore.getState().draft!.id, { status: "sending", requestId: "req-1" });
    expect(workflowStore.getState().draft).toMatchObject({ status: "sending", requestId: "req-1" });
  });

  it("updateGrpcDraft is a no-op when there is no draft", () => {
    workflowStore.updateGrpcDraft("gone", { status: "ok" });
    expect(workflowStore.getState().draft).toBeNull();
  });

  it("updateGrpcDraft drops a patch addressed to a replaced draft", () => {
    const old = newStep({ address: "h", tls: false, service: "S", method: "M" });
    workflowStore.setDraft(old);
    const next = newStep({ address: "h2", tls: false, service: "S", method: "N" });
    workflowStore.setDraft(next);
    workflowStore.updateGrpcDraft(old.id, { status: "ok", requestJson: '{"late":1}' });
    expect(workflowStore.getState().draft).toBe(next);
    expect(workflowStore.getState().draftDirty).toBe(false);
    workflowStore.updateGrpcDraft(next.id, { status: "sending" });
    expect(workflowStore.getState().draft).toEqual({ ...next, status: "sending" });
  });

  it("commitExecutedStep appends a snapshot to the active workflow and activates it; draft untouched", () => {
    const draft = newStep({ address: "h", tls: false, service: "S", method: "M" });
    workflowStore.setDraft(draft);
    const snap = newStep({ address: "h", tls: false, service: "S", method: "M" });
    workflowStore.commitExecutedStep(snap);
    const wf = workflowStore.activeWorkflow();
    expect(wf.steps.map((s) => s.id)).toEqual([snap.id]);
    expect(wf.activeStepId).toBe(snap.id);
    expect(workflowStore.getState().draft).toBe(draft); // draft remains in Focus
  });

  it("the global draft survives createWorkflow and setActiveWorkflow (regression: dd6001f)", () => {
    const draft = newStep({ address: "h", tls: false, service: "S", method: "M" });
    workflowStore.setDraft(draft);
    const first = workflowStore.getState().activeWorkflowId;
    workflowStore.createWorkflow("wf-2");
    expect(workflowStore.getState().draft).toBe(draft); // not dropped when state is rebuilt
    workflowStore.setActiveWorkflow(first);
    expect(workflowStore.getState().draft).toBe(draft); // one global draft across workflows
  });
});

describe("draft origin + dirty", () => {
  beforeEach(() => workflowStore.reset());

  it("starts unbound and clean", () => {
    expect(workflowStore.getState().draftOrigin).toBeNull();
    expect(workflowStore.getState().draftDirty).toBe(false);
  });

  it("setDraft(step) leaves it unbound and clean", () => {
    workflowStore.setDraft(newStep({ address: "h", tls: false, service: "S", method: "M" }));
    expect(workflowStore.getState().draftOrigin).toBeNull();
    expect(workflowStore.getState().draftDirty).toBe(false);
  });

  it("setDraft(step, origin) binds the origin and is clean", () => {
    const origin = { collectionId: "c1", requestId: "r1" };
    workflowStore.setDraft(newStep({ address: "h", tls: false, service: "S", method: "M" }), origin);
    expect(workflowStore.getState().draftOrigin).toEqual(origin);
    expect(workflowStore.getState().draftDirty).toBe(false);
  });

  it("content edits on an UNBOUND draft set dirty", () => {
    workflowStore.setDraft(newStep({ address: "h", tls: false, service: "S", method: "M" }));
    workflowStore.updateGrpcDraft(workflowStore.getState().draft!.id, { requestJson: '{"a":1}' });
    expect(workflowStore.getState().draftDirty).toBe(true);
  });

  it("transient (non-content) edits never set dirty", () => {
    workflowStore.setDraft(newStep({ address: "h", tls: false, service: "S", method: "M" }));
    workflowStore.updateGrpcDraft(workflowStore.getState().draft!.id, { status: "sending", requestId: "req-1" });
    expect(workflowStore.getState().draftDirty).toBe(false);
  });

  it("content edits on a BOUND draft do NOT set dirty (autosave path)", () => {
    workflowStore.setDraft(newStep({ address: "h", tls: false, service: "S", method: "M" }), {
      collectionId: "c1", requestId: "r1",
    });
    workflowStore.updateGrpcDraft(workflowStore.getState().draft!.id, { requestJson: '{"a":1}' });
    expect(workflowStore.getState().draftDirty).toBe(false);
  });

  it("setDraftOrigin binds and clears dirty (used after Save)", () => {
    workflowStore.setDraft(newStep({ address: "h", tls: false, service: "S", method: "M" }));
    workflowStore.updateGrpcDraft(workflowStore.getState().draft!.id, { requestJson: '{"a":1}' }); // dirty now
    workflowStore.setDraftOrigin({ collectionId: "c1", requestId: "r1" });
    expect(workflowStore.getState().draftOrigin).toEqual({ collectionId: "c1", requestId: "r1" });
    expect(workflowStore.getState().draftDirty).toBe(false);
  });

  it("clearDraft resets origin and dirty", () => {
    workflowStore.setDraft(newStep({ address: "h", tls: false, service: "S", method: "M" }), {
      collectionId: "c1", requestId: "r1",
    });
    workflowStore.clearDraft();
    expect(workflowStore.getState().draftOrigin).toBeNull();
    expect(workflowStore.getState().draftDirty).toBe(false);
  });

  it("setDraft(step, origin) stamps the origin's collectionId onto the step", () => {
    workflowStore.setDraft(
      newStep({ address: "h", tls: false, service: "S", method: "M" }),
      { collectionId: "c1", requestId: "r1" },
    );
    expect(workflowStore.getState().draft?.collectionId).toBe("c1");
  });

  it("setDraftOrigin patches the existing draft's collectionId (Save binding)", () => {
    workflowStore.setDraft(newStep({ address: "h", tls: false, service: "S", method: "M" }));
    expect(workflowStore.getState().draft?.collectionId).toBeNull();
    workflowStore.setDraftOrigin({ collectionId: "c1", requestId: "r1" });
    expect(workflowStore.getState().draft?.collectionId).toBe("c1");
  });

  it("setDraftOrigin(null) clears the draft's collectionId", () => {
    workflowStore.setDraft(
      newStep({ address: "h", tls: false, service: "S", method: "M" }),
      { collectionId: "c1", requestId: "r1" },
    );
    workflowStore.setDraftOrigin(null);
    expect(workflowStore.getState().draft?.collectionId).toBeNull();
  });

  it("isContentPatch detects content vs transient keys", () => {
    expect(isContentPatch({ requestJson: "x" })).toBe(true);
    expect(isContentPatch({ metadata: [] })).toBe(true);
    expect(isContentPatch({ address: "h" })).toBe(true);
    expect(isContentPatch({ status: "ok" })).toBe(false);
    expect(isContentPatch({ requestId: "r" })).toBe(false);
  });
});

describe("HTTP draft", () => {
  beforeEach(() => workflowStore.reset());

  const response: HttpResponseIpc = {
    status: 200, reason: "OK", headers: [], body: { type: "empty" }, size_bytes: 0, elapsed_ms: 1,
  };

  it("editHttpTemplate merges a template patch and dirties an unbound draft", () => {
    const d = newHttpStep();
    workflowStore.setDraft(d);
    workflowStore.editHttpTemplate(d.id, { method: "POST", url_template: "{{base}}/users" });
    expect(workflowStore.getState().draft).toEqual({
      ...d, template: { ...d.template, method: "POST", url_template: "{{base}}/users" },
    });
    expect(workflowStore.getState().draftDirty).toBe(true);
  });

  it("editHttpTemplate on a bound draft does not dirty it (autosave path)", () => {
    const d = newHttpStep();
    workflowStore.setDraft(d, { collectionId: "c1", requestId: "h1" });
    workflowStore.editHttpTemplate(d.id, { url_template: "x" });
    expect(workflowStore.getState().draftDirty).toBe(false);
  });

  it("drops an edit or a run addressed to a replaced draft", () => {
    const old = newHttpStep();
    const next = newHttpStep();
    workflowStore.setDraft(old);
    workflowStore.setDraft(next);
    workflowStore.editHttpTemplate(old.id, { url_template: "late" });
    workflowStore.setHttpRun(old.id, { status: "sending", requestId: "r" });
    expect(workflowStore.getState().draft).toBe(next);
    expect(workflowStore.getState().draftDirty).toBe(false);
  });

  it("setHttpRun keeps the template object and never dirties", () => {
    const d = newHttpStep();
    workflowStore.setDraft(d);
    workflowStore.setHttpRun(d.id, { status: "done", response, authUsed: { kind: "none" } });
    const after = workflowStore.getState().draft;
    expect(after).toEqual({ ...d, run: { status: "done", response, authUsed: { kind: "none" } } });
    expect(narrow(after, "http").template).toBe(d.template);
    expect(workflowStore.getState().draftDirty).toBe(false);
  });

  it("gRPC updates and HTTP edits ignore a draft of the other protocol", () => {
    const http = newHttpStep();
    workflowStore.setDraft(http);
    workflowStore.updateGrpcDraft(http.id, { requestJson: "{}" });
    expect(workflowStore.getState().draft).toBe(http);
    const grpc = newStep({ address: "h", tls: false, service: "S", method: "M" });
    workflowStore.setDraft(grpc);
    workflowStore.editHttpTemplate(grpc.id, { url_template: "x" });
    workflowStore.setHttpRun(grpc.id, { status: "draft" });
    expect(workflowStore.getState().draft).toBe(grpc);
    expect(workflowStore.getState().draftDirty).toBe(false);
  });
});

describe("workflowStore.hydrateEnv", () => {
  it("sets the active workflow env without calling envActiveSet", () => {
    workflowStore.hydrateEnv("staging");
    expect(workflowStore.activeWorkflow().envName).toBe("staging");
    expect(envActiveSet).not.toHaveBeenCalled();
  });

  it("accepts null (no environment)", () => {
    workflowStore.hydrateEnv("staging");
    workflowStore.hydrateEnv(null);
    expect(workflowStore.activeWorkflow().envName).toBeNull();
    expect(envActiveSet).not.toHaveBeenCalled();
  });
});
