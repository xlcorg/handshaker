import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { IpcError, MethodKindIpc, SendReportIpc, StreamEventIpc } from "@/ipc/bindings";

// Two shapes of the facade: named exports (what `import * as ipc` reads) AND the `ipc`
// object — mocking one alone leaves the other path silently unreachable.
const mocks = vi.hoisted(() => {
  const api = {
    grpcSend: vi.fn<(...a: unknown[]) => Promise<SendReportIpc>>(),
    streamOpen: vi.fn<(...a: unknown[]) => Promise<void>>(),
    streamSend: vi.fn(),
    streamHalfClose: vi.fn().mockResolvedValue(undefined),
    grpcCancel: vi.fn().mockResolvedValue(undefined),
    streamRelease: vi.fn().mockResolvedValue(undefined),
    envActiveSet: vi.fn().mockResolvedValue(undefined),
  };
  return { api, bumpUsage: vi.fn(() => Promise.resolve()) };
});
vi.mock("@/ipc/client", () => ({ ...mocks.api, ipc: mocks.api }));
vi.mock("@/features/catalog/CatalogProvider", () => ({ useCatalog: () => ({ bumpUsage: mocks.bumpUsage }) }));

import { useCall } from "./useCall";
import { streamStore } from "@/features/stream/streamStore";
import { workflowStore } from "./store";
import { newStep, type Step } from "./model";

const mismatch = (expected: MethodKindIpc, actual: MethodKindIpc): IpcError => ({
  type: "MethodKindMismatch", service: "pkg.Svc", method: "M", expected, actual,
});
const openedAs = (kind: MethodKindIpc): StreamEventIpc => ({
  type: "Opened", kind, auth_used: { kind: "none" }, tls_used: true, bytes_fields: [],
});
const report: SendReportIpc = {
  outcome: { status_code: 0, status_message: "", response_json: "{}", trailing_metadata: {}, status_details: [], elapsed_ms: 5 },
  auth_used: { kind: "none" },
  tls_used: false,
};

/** `streamOpen` resolves at Opened with the kind it was asked for (core agrees). */
function openResolves() {
  mocks.api.streamOpen.mockImplementation(async (...a: unknown[]) => {
    (a[5] as (e: StreamEventIpc) => void)(openedAs(a[3] as MethodKindIpc));
  });
}

function draft(): Step {
  return newStep({ address: "h:443", tls: true, service: "pkg.Svc", method: "M", requestJson: "{}" });
}

function renderCall(step: Step, kind: MethodKindIpc | null) {
  const patches: Partial<Step>[] = [];
  const hook = renderHook(() =>
    useCall({ step, envName: null, kind, onPatch: (p) => patches.push(p), record: true }),
  );
  return { ...hook, patches };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => { cb(0); return 1; });
  workflowStore.reset();
  streamStore.reset();
});
afterEach(() => vi.unstubAllGlobals());

describe("useCall one-shot re-route on a kind mismatch", () => {
  it("null UI kind + Send on a server-streaming method: grpcSend refused → streamOpen(kind 'server') once, the step becomes a live stream", async () => {
    mocks.api.grpcSend.mockRejectedValue(mismatch("unary", "server"));
    openResolves();
    const { result, patches } = renderCall(draft(), null);

    await act(() => result.current.send());

    expect(mocks.api.grpcSend).toHaveBeenCalledTimes(1);
    expect(mocks.api.streamOpen).toHaveBeenCalledTimes(1);
    expect(mocks.api.streamOpen.mock.calls[0][3]).toBe("server");
    // Exactly as if the stream path had been chosen: live, with the stream reference.
    const last = patches[patches.length - 1];
    expect(last).toMatchObject({ status: "sending", error: null });
    expect(last.streamId).toBe(last.requestId);
    expect(streamStore.get(last.streamId!)).toMatchObject({ phase: "open", kind: "server" });
    // Never an error patch in between.
    expect(patches.every((p) => p.status !== "error")).toBe(true);
  });

  it("Open with a stale 'server' kind on a bidi method: streamOpen again with 'bidi'", async () => {
    mocks.api.streamOpen
      .mockRejectedValueOnce(mismatch("server", "bidi"))
      .mockImplementationOnce(async (...a: unknown[]) => {
        (a[5] as (e: StreamEventIpc) => void)(openedAs("bidi"));
      });
    const { result, patches } = renderCall(draft(), "server");

    await act(() => result.current.send());

    expect(mocks.api.streamOpen).toHaveBeenCalledTimes(2);
    expect(mocks.api.streamOpen.mock.calls.map((c) => c[3])).toEqual(["server", "bidi"]);
    expect(mocks.api.grpcSend).not.toHaveBeenCalled();
    const last = patches[patches.length - 1];
    expect(last).toMatchObject({ status: "sending" });
    expect(streamStore.get(last.streamId!)).toMatchObject({ phase: "open", kind: "bidi" });
    // The refused attempt's entry is gone; only the live one remains.
    const first = patches[0].streamId!;
    expect(first).not.toBe(last.streamId);
    expect(streamStore.get(first)).toBeNull();
  });

  it("a unary method mistakenly opened as a stream falls back to grpcSend and completes as unary", async () => {
    mocks.api.streamOpen.mockRejectedValue(mismatch("server", "unary"));
    mocks.api.grpcSend.mockResolvedValue(report);
    const { result, patches } = renderCall(draft(), "server");

    await act(() => result.current.send());

    expect(mocks.api.streamOpen).toHaveBeenCalledTimes(1);
    expect(mocks.api.grpcSend).toHaveBeenCalledTimes(1);
    const last = patches[patches.length - 1];
    expect(last).toMatchObject({ status: "ok", outcome: report.outcome, requestId: null });
    // The unary path drops the stale stream reference.
    expect(patches.some((p) => p.status === "sending" && p.streamId === null)).toBe(true);
    expect(workflowStore.activeWorkflow().steps).toHaveLength(1);
    expect(workflowStore.activeWorkflow().steps[0]).toMatchObject({ status: "ok", streamId: null });
  });

  it("a second mismatch shows the face instead of looping: exactly two IPC calls, kind_mismatch error patch", async () => {
    mocks.api.grpcSend.mockRejectedValue(mismatch("unary", "server"));
    mocks.api.streamOpen.mockRejectedValue(mismatch("server", "bidi"));
    const { result, patches } = renderCall(draft(), null);

    await act(() => result.current.send());

    expect(mocks.api.grpcSend).toHaveBeenCalledTimes(1);
    expect(mocks.api.streamOpen).toHaveBeenCalledTimes(1);
    const last = patches[patches.length - 1];
    expect(last).toMatchObject({
      status: "error",
      requestId: null,
      streamId: null,
      outcome: null,
      error: { kind: "kind_mismatch", mismatch: { expected: "server", actual: "bidi" } },
    });
    expect(workflowStore.activeWorkflow().steps).toHaveLength(0);
  });

  it("cancel between the refusal and the retry wins: no second IPC call, the step leaves sending", async () => {
    // The first attempt is refused one IPC round trip later; the user cancels in between.
    let refuse!: (e: unknown) => void;
    mocks.api.grpcSend.mockImplementation(() => new Promise<SendReportIpc>((_, rej) => { refuse = rej; }));
    openResolves();
    const { result, patches } = renderCall(draft(), null);

    let sending!: Promise<void>;
    act(() => { sending = result.current.send(); });
    await act(() => result.current.cancel());
    await act(async () => { refuse(mismatch("unary", "server")); await sending; });

    expect(mocks.api.grpcSend).toHaveBeenCalledTimes(1);
    expect(mocks.api.streamOpen).not.toHaveBeenCalled();
    // Back to a non-sending state exactly as a unary cancel: status/requestId reset, no error.
    expect(patches[patches.length - 1]).toMatchObject({ status: "draft", requestId: null, streamId: null, error: null });
    expect(workflowStore.activeWorkflow().steps).toHaveLength(0);
  });

  it("a cancel before Send does not poison the next Send: the re-route still runs", async () => {
    mocks.api.grpcSend.mockRejectedValue(mismatch("unary", "server"));
    openResolves();
    const { result, patches } = renderCall(draft(), null);
    await act(() => result.current.cancel()); // idle cancel: nothing in flight
    await act(() => result.current.send());
    expect(mocks.api.streamOpen).toHaveBeenCalledTimes(1);
    expect(patches[patches.length - 1]).toMatchObject({ status: "sending" });
  });

  it("no mismatch: a plain unary Send is one grpcSend and no streamOpen", async () => {
    mocks.api.grpcSend.mockResolvedValue(report);
    const { result, patches } = renderCall(draft(), null);
    await act(() => result.current.send());
    expect(mocks.api.grpcSend).toHaveBeenCalledTimes(1);
    expect(mocks.api.streamOpen).not.toHaveBeenCalled();
    expect(patches[patches.length - 1]).toMatchObject({ status: "ok" });
  });

  it("cancel follows the live call: a stream step cancels through the stream path", async () => {
    streamStore.open("rid", "server");
    const live = { ...draft(), status: "sending" as const, requestId: "rid", streamId: "rid" };
    const { result, patches } = renderCall(live, "server");
    await act(() => result.current.cancel());
    expect(mocks.api.grpcCancel).toHaveBeenCalledWith("rid");
    expect(streamStore.get("rid")?.phase).toBe("cancelled");
    expect(patches[patches.length - 1]).toMatchObject({ status: "cancelled", requestId: null });
  });
});
