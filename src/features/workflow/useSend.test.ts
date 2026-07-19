import { renderHook, act } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useSend } from "./useSend";
import { workflowStore } from "./store";
import { newStep } from "./model";
import type { SendResult } from "./actions";
import type { SendReportIpc } from "@/ipc/bindings";

const mocks = vi.hoisted(() => ({
  sendStep: vi.fn<(...args: unknown[]) => Promise<SendResult>>(),
  cancelStep: vi.fn(() => Promise.resolve()),
  bumpUsage: vi.fn(() => Promise.resolve()),
}));

vi.mock("./actions", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./actions")>()),
  sendStep: mocks.sendStep,
  cancelStep: mocks.cancelStep,
}));

vi.mock("@/features/catalog/CatalogProvider", () => ({
  useCatalog: () => ({ bumpUsage: mocks.bumpUsage }),
}));

const report: SendReportIpc = {
  outcome: {
    status_code: 0,
    status_message: "",
    response_json: "{}",
    trailing_metadata: {},
    status_details: [],
    elapsed_ms: 5,
  },
  auth_used: {
    kind: "env_var",
    env_var: "TOK",
    header_name: "authorization",
    prefix: "Bearer ",
    environments: [],
  },
  tls_used: true,
};

function draft() {
  return newStep({ address: "h:50051", service: "pkg.Svc", method: "Do" });
}

beforeEach(() => {
  vi.clearAllMocks();
  workflowStore.reset();
});

describe("useSend", () => {
  it("ok + record: patches, commits an executed snapshot with the report's auth/tls, bumps usage", async () => {
    mocks.sendStep.mockResolvedValue({ kind: "ok", report });
    const step = draft();
    const patches: object[] = [];
    const origin = { collectionId: "c1", requestId: "r1" };
    const { result } = renderHook(() =>
      useSend({ step, envName: "dev", onPatch: (p) => patches.push(p), record: true, origin }),
    );

    await act(() => result.current.send());

    expect(patches[0]).toMatchObject({ status: "sending", error: null });
    expect(patches[1]).toMatchObject({ status: "ok", outcome: report.outcome, requestId: null });

    const executed = workflowStore.activeWorkflow().steps;
    expect(executed).toHaveLength(1);
    // The snapshot records fact from the Send report — not a second auth_effective fetch.
    expect(executed[0].auth).toEqual(report.auth_used);
    expect(executed[0].tls).toBe(true);
    expect(executed[0].id).not.toBe(step.id);
    expect(executed[0].requestId).toBeNull();
    expect(mocks.bumpUsage).toHaveBeenCalledWith("c1", "r1", expect.any(Number));
  });

  it("ok without record: patches but commits nothing and bumps nothing", async () => {
    mocks.sendStep.mockResolvedValue({ kind: "ok", report });
    const { result } = renderHook(() =>
      useSend({ step: draft(), envName: null, onPatch: () => {} }),
    );
    await act(() => result.current.send());
    expect(workflowStore.activeWorkflow().steps).toHaveLength(0);
    expect(mocks.bumpUsage).not.toHaveBeenCalled();
  });

  it("record without origin: commits the snapshot but does not bump usage", async () => {
    mocks.sendStep.mockResolvedValue({ kind: "ok", report });
    const { result } = renderHook(() =>
      useSend({ step: draft(), envName: null, onPatch: () => {}, record: true }),
    );
    await act(() => result.current.send());
    expect(workflowStore.activeWorkflow().steps).toHaveLength(1);
    expect(mocks.bumpUsage).not.toHaveBeenCalled();
  });

  it("unresolved: error patch listing the vars, no snapshot", async () => {
    mocks.sendStep.mockResolvedValue({ kind: "unresolved", unresolved: ["host"], cycle: null });
    const patches: object[] = [];
    const { result } = renderHook(() =>
      useSend({ step: draft(), envName: null, onPatch: (p) => patches.push(p), record: true }),
    );
    await act(() => result.current.send());
    expect(patches[1]).toMatchObject({
      status: "error",
      outcome: null,
      error: { kind: "other", message: "Unresolved variables: {{host}}" },
    });
    expect(workflowStore.activeWorkflow().steps).toHaveLength(0);
  });

  it("cancelled: returns the step to draft", async () => {
    mocks.sendStep.mockResolvedValue({ kind: "cancelled" });
    const patches: object[] = [];
    const { result } = renderHook(() =>
      useSend({ step: draft(), envName: null, onPatch: (p) => patches.push(p) }),
    );
    await act(() => result.current.send());
    expect(patches[1]).toMatchObject({ status: "draft", outcome: null, error: null });
  });

  it("gate: a step already sending does not send again", async () => {
    const step = { ...draft(), status: "sending" as const };
    const { result } = renderHook(() =>
      useSend({ step, envName: null, onPatch: () => {} }),
    );
    await act(() => result.current.send());
    expect(mocks.sendStep).not.toHaveBeenCalled();
  });

  it("cancel: forwards the in-flight requestId to cancelStep", () => {
    const step = { ...draft(), requestId: "rid-1" };
    const { result } = renderHook(() =>
      useSend({ step, envName: null, onPatch: () => {} }),
    );
    act(() => result.current.cancel());
    expect(mocks.cancelStep).toHaveBeenCalledWith("rid-1");
  });
});
