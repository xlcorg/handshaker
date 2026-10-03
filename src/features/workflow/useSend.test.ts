import { renderHook, act } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useSend, executedSnapshot, bumpOriginUsage } from "./useSend";
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

  it("unresolved (a client fault from sendStep): error patch listing the vars, no snapshot", async () => {
    mocks.sendStep.mockResolvedValue({
      kind: "error",
      fault: { kind: "other", message: "Unresolved variables: {{host}}" },
    });
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

  it("kind mismatch: returned to the caller un-patched (the step stays sending), nothing recorded", async () => {
    const fault = {
      kind: "kind_mismatch" as const,
      message: "pkg.Svc/Do is server-streaming but was called as unary",
      mismatch: { service: "pkg.Svc", method: "Do", expected: "unary" as const, actual: "server" as const },
    };
    mocks.sendStep.mockResolvedValue({ kind: "error", fault });
    const patches: object[] = [];
    const { result } = renderHook(() =>
      useSend({ step: draft(), envName: null, onPatch: (p) => patches.push(p), record: true }),
    );

    const refused = await act(() => result.current.send());

    expect(refused).toEqual(fault);
    expect(patches).toHaveLength(1);
    expect(patches[0]).toMatchObject({ status: "sending" });
    expect(workflowStore.activeWorkflow().steps).toHaveLength(0);
  });

  it("retry: the second attempt of a re-route runs while the step is already sending (the caller owns the gate)", async () => {
    mocks.sendStep.mockResolvedValue({ kind: "ok", report });
    const patches: object[] = [];
    const live = { ...draft(), status: "sending" as const, requestId: "stale" };
    const { result } = renderHook(() =>
      useSend({ step: live, envName: null, onPatch: (p) => patches.push(p) }),
    );

    await act(() => result.current.send({ retry: true }));

    expect(mocks.sendStep).toHaveBeenCalledTimes(1);
    expect(patches[0]).toMatchObject({ status: "sending", streamId: null });
    expect(patches[patches.length - 1]).toMatchObject({ status: "ok", requestId: null });
    // Without `retry` the same step stays gated.
    await act(() => result.current.send());
    expect(mocks.sendStep).toHaveBeenCalledTimes(1);
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

describe("useSend helpers shared with the streaming path", () => {
  it("executedSnapshot freezes the report's auth/TLS, applies the patch, and gets a fresh id", () => {
    const step = { ...draft(), requestId: "rid" };
    const snap = executedSnapshot(step, report, { status: "ok", outcome: report.outcome, error: null });
    expect(snap.auth).toEqual(report.auth_used);
    expect(snap.tls).toBe(true);
    expect(snap.status).toBe("ok");
    expect(snap.outcome).toBe(report.outcome);
    expect(snap.id).not.toBe(step.id);
    expect(snap.requestId).toBeNull();
    expect(snap.method).toBe("Do"); // everything else is the step as sent
  });

  it("bumpOriginUsage credits the saved request once and is a no-op without an origin", async () => {
    await bumpOriginUsage(mocks.bumpUsage, { collectionId: "c1", requestId: "r1" });
    expect(mocks.bumpUsage).toHaveBeenCalledWith("c1", "r1", expect.any(Number));
    mocks.bumpUsage.mockClear();
    await bumpOriginUsage(mocks.bumpUsage, null);
    expect(mocks.bumpUsage).not.toHaveBeenCalled();
  });

  it("bumpOriginUsage swallows a failing bump (usage is best-effort)", async () => {
    mocks.bumpUsage.mockRejectedValueOnce(new Error("offline"));
    await expect(bumpOriginUsage(mocks.bumpUsage, { collectionId: "c1", requestId: "r1" })).resolves.toBeUndefined();
  });
});
