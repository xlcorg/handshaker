import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MethodKindIpc, StreamEventIpc } from "@/ipc/bindings";

// Two shapes of the facade: named exports (what `import * as ipc` reads) AND the `ipc`
// object — mocking one alone leaves the other path silently unreachable.
const mocks = vi.hoisted(() => {
  const api = {
    streamOpen: vi.fn<(...a: unknown[]) => Promise<void>>(),
    streamSend: vi.fn<(...a: unknown[]) => Promise<unknown>>(),
    streamHalfClose: vi.fn<(id: string) => Promise<void>>().mockResolvedValue(undefined),
    grpcCancel: vi.fn<(id: string) => Promise<void>>().mockResolvedValue(undefined),
    streamRelease: vi.fn().mockResolvedValue(undefined),
    envActiveSet: vi.fn().mockResolvedValue(undefined),
  };
  return { api, bumpUsage: vi.fn(() => Promise.resolve()) };
});
vi.mock("@/ipc/client", () => ({ ...mocks.api, ipc: mocks.api }));
vi.mock("@/features/catalog/CatalogProvider", () => ({ useCatalog: () => ({ bumpUsage: mocks.bumpUsage }) }));

import { useStreamCall } from "./useStreamCall";
import { streamStore } from "./streamStore";
import { workflowStore } from "@/features/workflow/store";
import { newStep, type Step } from "@/features/workflow/model";

const openedAs = (kind: MethodKindIpc): StreamEventIpc => ({
  type: "Opened", kind, auth_used: { kind: "none" }, tls_used: true, bytes_fields: [],
});
const opened = openedAs("server");
const end = (code: number): StreamEventIpc => ({
  type: "End", status_code: code, status_message: "", status_details: [], trailing_metadata: {},
  elapsed_ms: 50, message_count: 0, total_bytes: 0,
});

/** Resolve `streamOpen` at Opened and hand the test the channel handler. */
function openResolves() {
  let onEvent: ((e: StreamEventIpc) => void) | null = null;
  mocks.api.streamOpen.mockImplementation(async (...a: unknown[]) => {
    onEvent = a[5] as (e: StreamEventIpc) => void;
    onEvent(opened);
  });
  return () => onEvent!;
}

function draft(over: Partial<Step> = {}): Step {
  return {
    ...newStep({ address: "{{host}}", tls: null, service: "pkg.Svc", method: "Watch", requestJson: '{"a":1}',
      metadata: [{ key: "x", value: "1", enabled: true }, { key: "off", value: "2", enabled: false }] }),
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => { cb(0); return 1; });
  workflowStore.reset();
  streamStore.reset();
});
afterEach(() => vi.unstubAllGlobals());

describe("useStreamCall", () => {
  it("open: registers the entry, patches sending + streamId, calls streamOpen with draft/ctx/kind/opts", async () => {
    openResolves();
    const step = draft({ collectionId: "c1" });
    const patches: Partial<Step>[] = [];
    const { result } = renderHook(() =>
      useStreamCall({ step, envName: "dev", onPatch: (p) => patches.push(p) }),
    );

    await act(() => result.current.open("server"));

    expect(patches[0]).toMatchObject({ status: "sending", error: null, outcome: null });
    const id = patches[0].requestId!;
    expect(id).toBeTruthy();
    expect(patches[0].streamId).toBe(id);
    expect(streamStore.get(id)?.phase).toBe("open");

    const [d, ctx, rid, kind, opts] = mocks.api.streamOpen.mock.calls[0];
    expect(d).toEqual({
      address_template: "{{host}}", tls_override: null, service: "pkg.Svc", method: "Watch", body_template: '{"a":1}',
      metadata: [{ key: "x", value: "1", enabled: true }], auth: { kind: "none" },
    });
    expect(ctx).toEqual({ collection_id: "c1", env_name: "dev" });
    expect(rid).toBe(id);
    expect(kind).toBe("server");
    expect(opts).toMatchObject({ timeout_ms: expect.any(Number), max_message_bytes: expect.any(Number) });
    // Status stays "sending" after Opened — the outcome arrives on the channel.
    expect(patches).toHaveLength(1);
  });

  it("End OK → ok; with record: executed snapshot carries the stream id + Opened's auth/tls, usage bumped", async () => {
    const events = openResolves();
    const step = draft();
    const patches: Partial<Step>[] = [];
    const origin = { collectionId: "c1", requestId: "r1" };
    const { result } = renderHook(() =>
      useStreamCall({ step, envName: null, onPatch: (p) => patches.push(p), record: true, origin }),
    );
    await act(() => result.current.open("server"));
    act(() => events()(end(0)));

    expect(patches[1]).toMatchObject({ status: "ok", requestId: null });
    const [snap] = workflowStore.activeWorkflow().steps;
    expect(snap).toMatchObject({ status: "ok", streamId: patches[0].streamId, tls: true, auth: { kind: "none" }, requestId: null, outcome: null });
    expect(snap.id).not.toBe(step.id);
    expect(mocks.bumpUsage).toHaveBeenCalledWith("c1", "r1", expect.any(Number));
  });

  it("End non-OK → error (no client fault); nothing recorded without record", async () => {
    const events = openResolves();
    const patches: Partial<Step>[] = [];
    const { result } = renderHook(() =>
      useStreamCall({ step: draft(), envName: null, onPatch: (p) => patches.push(p) }),
    );
    await act(() => result.current.open("server"));
    act(() => events()(end(5)));
    expect(patches[1]).toMatchObject({ status: "error", error: null, requestId: null });
    expect(workflowStore.activeWorkflow().steps).toHaveLength(0);
  });

  it("post-Open Fault → the client fault on the step (same mapping as pre-Open), status error", async () => {
    const events = openResolves();
    const patches: Partial<Step>[] = [];
    const { result } = renderHook(() =>
      useStreamCall({ step: draft(), envName: null, onPatch: (p) => patches.push(p) }),
    );
    await act(() => result.current.open("server"));
    act(() => events()({ type: "Fault", error: { type: "DeadlineExceeded", timeout_ms: 30_000 } }));

    expect(patches[1]).toMatchObject({
      status: "error",
      requestId: null,
      error: { kind: "timeout", message: "Request timed out after 30000ms" },
    });
    // The entry stays (rows would stay too) so the step keeps its stream reference.
    expect(streamStore.get(patches[0].streamId!)?.phase).toBe("faulted");
  });

  it("cancel: grpcCancel(requestId), entry cancelled with frozen elapsed, status cancelled", async () => {
    openResolves();
    const patches: Partial<Step>[] = [];
    const step = draft();
    const { result, rerender } = renderHook(
      ({ s }: { s: Step }) => useStreamCall({ step: s, envName: null, onPatch: (p) => patches.push(p) }),
      { initialProps: { s: step } },
    );
    await act(() => result.current.open("server"));
    const live = { ...step, ...patches[0] } as Step;
    rerender({ s: live });

    await act(() => result.current.cancel());

    expect(mocks.api.grpcCancel).toHaveBeenCalledWith(live.requestId);
    expect(streamStore.get(live.streamId!)).toMatchObject({ phase: "cancelled", cancelled: true });
    expect(streamStore.get(live.streamId!)!.elapsedMs).not.toBeNull();
    expect(patches[1]).toMatchObject({ status: "cancelled", requestId: null });
  });

  it("pre-Open rejection: client fault on the step, streamId cleared, entry dropped", async () => {
    mocks.api.streamOpen.mockRejectedValue({ type: "DeadlineExceeded", timeout_ms: 30_000 });
    const patches: Partial<Step>[] = [];
    const { result } = renderHook(() =>
      useStreamCall({ step: draft(), envName: null, onPatch: (p) => patches.push(p) }),
    );
    await act(() => result.current.open("server"));
    expect(patches[1]).toMatchObject({ status: "error", requestId: null, streamId: null, error: { kind: "timeout" } });
    expect(streamStore.get(patches[0].streamId!)).toBeNull();
  });

  it("pre-Open MethodKindMismatch: returned to the caller un-patched (the step stays sending), entry dropped", async () => {
    mocks.api.streamOpen.mockRejectedValue({
      type: "MethodKindMismatch", service: "pkg.Svc", method: "Watch", expected: "server", actual: "bidi",
    });
    const patches: Partial<Step>[] = [];
    const { result } = renderHook(() => useStreamCall({ step: draft(), envName: null, onPatch: (p) => patches.push(p) }));

    const refused = await act(() => result.current.open("server"));

    expect(refused).toMatchObject({ kind: "kind_mismatch", mismatch: { expected: "server", actual: "bidi" } });
    // No error patch: the caller decides (re-route or face).
    expect(patches).toHaveLength(1);
    expect(patches[0]).toMatchObject({ status: "sending" });
    expect(streamStore.get(patches[0].streamId!)).toBeNull();
  });

  it("retry: the second attempt of a re-route opens while the step is already sending (the caller owns the gate)", async () => {
    // Resolves at Opened with the kind it was asked for (core agrees).
    mocks.api.streamOpen.mockImplementation(async (...a: unknown[]) => {
      (a[5] as (e: StreamEventIpc) => void)(openedAs(a[3] as MethodKindIpc));
    });
    const patches: Partial<Step>[] = [];
    const live = draft({ status: "sending", requestId: "stale", streamId: "stale" });
    const { result } = renderHook(() => useStreamCall({ step: live, envName: null, onPatch: (p) => patches.push(p) }));

    await act(() => result.current.open("bidi", { retry: true }));

    expect(mocks.api.streamOpen).toHaveBeenCalledTimes(1);
    expect(mocks.api.streamOpen.mock.calls[0][3]).toBe("bidi");
    expect(patches[0]).toMatchObject({ status: "sending" });
    expect(patches[0].streamId).not.toBe("stale");
    expect(streamStore.get(patches[0].streamId!)).toMatchObject({ phase: "open", kind: "bidi" });
    // Without `retry` the same step stays gated.
    await act(() => result.current.open("bidi"));
    expect(mocks.api.streamOpen).toHaveBeenCalledTimes(1);
  });

  it("pre-Open unresolved vars: the unary message; gate: a sending step does not open again", async () => {
    mocks.api.streamOpen.mockRejectedValue({ type: "UnresolvedVars", unresolved: ["host"], cycle: null });
    const patches: Partial<Step>[] = [];
    const { result } = renderHook(() =>
      useStreamCall({ step: draft(), envName: null, onPatch: (p) => patches.push(p) }),
    );
    await act(() => result.current.open("server"));
    expect(patches[1]).toMatchObject({ status: "error", error: { kind: "other", message: "Unresolved variables: {{host}}" } });

    const gated = renderHook(() =>
      useStreamCall({ step: draft({ status: "sending" }), envName: null, onPatch: () => {} }),
    );
    await act(() => gated.result.current.open("server"));
    expect(mocks.api.streamOpen).toHaveBeenCalledTimes(1);
  });
});

describe("useStreamCall two-way (client / bidi)", () => {
  const pretty = '{\n  "a": 1\n}';
  const ack = { index: 1, at_ms: 1_700_000_000_001, size_bytes: 9, preview: '{"a":1}', json: pretty };

  /** Open a bidi call and hand back the live step (requestId/streamId patched) + the hook. */
  async function openLive(over: Partial<Step> = {}, envName: string | null = "dev") {
    mocks.api.streamOpen.mockImplementation(async (...a: unknown[]) => {
      (a[5] as (e: StreamEventIpc) => void)(openedAs("bidi"));
    });
    const patches: Partial<Step>[] = [];
    const step = draft({ collectionId: "c1", ...over });
    const hook = renderHook(
      ({ s }: { s: Step }) => useStreamCall({ step: s, envName, onPatch: (p) => patches.push(p) }),
      { initialProps: { s: step } },
    );
    await act(() => hook.result.current.open("bidi"));
    const live = { ...step, ...patches[0] } as Step;
    hook.rerender({ s: live });
    return { ...hook, live, patches };
  }

  it("open with kind client/bidi passes the kind through and sends nothing itself", async () => {
    const { live } = await openLive();
    expect(mocks.api.streamOpen.mock.calls[0][3]).toBe("bidi");
    expect(mocks.api.streamSend).not.toHaveBeenCalled();
    expect(streamStore.get(live.streamId!)).toMatchObject({ phase: "open", kind: "bidi", halfClosed: false });
  });

  it("sendMessage: streamSend(requestId, current body template, ctx of this moment) → the ack becomes a → row", async () => {
    mocks.api.streamSend.mockResolvedValue(ack);
    const { result, live, rerender } = await openLive();
    // The body edited after Open is what goes out — template intact, core resolves.
    rerender({ s: { ...live, requestJson: '{"a":"{{v}}"}' } });

    await act(() => result.current.sendMessage());

    expect(mocks.api.streamSend).toHaveBeenCalledWith(live.requestId, '{"a":"{{v}}"}', { collection_id: "c1", env_name: "dev" });
    const e = streamStore.get(live.streamId!)!;
    expect(e.messages).toEqual([{ dir: "out", index: 1, atMs: 1_700_000_000_001, sizeBytes: 9, preview: '{"a":1}', json: pretty }]);
    expect(e.phase).toBe("open");
    expect(e.sendFault).toBeNull();
  });

  it("sendMessage on UnresolvedVars: the unary unresolved message lands as the entry's send fault; the stream stays open, the step stays sending", async () => {
    mocks.api.streamSend.mockRejectedValue({ type: "UnresolvedVars", unresolved: ["v"], cycle: null });
    const { result, live, patches } = await openLive();

    await act(() => result.current.sendMessage());

    const e = streamStore.get(live.streamId!)!;
    expect(e.phase).toBe("open");
    expect(e.messages).toHaveLength(0);
    expect(e.sendFault).toEqual({ kind: "other", message: "Unresolved variables: {{v}}" });
    // No terminal patch: the step is still the live call.
    expect(patches).toHaveLength(1);
  });

  it("sendMessage on EncodeRequest (invalid body): encode fault on the entry, stream open, nothing pushed", async () => {
    mocks.api.streamSend.mockRejectedValue({ type: "EncodeRequest", message: "expected value at line 1" });
    const { result, live } = await openLive();
    await act(() => result.current.sendMessage());
    expect(streamStore.get(live.streamId!)).toMatchObject({
      phase: "open", messages: [], sendFault: { kind: "encode", message: "expected value at line 1" },
    });
  });

  it("sendMessage on StreamClosed: the user-facing message, never the discriminator", async () => {
    mocks.api.streamSend.mockRejectedValue({ type: "StreamClosed", request_id: "x" });
    const { result, live } = await openLive();
    await act(() => result.current.sendMessage());
    expect(streamStore.get(live.streamId!)!.sendFault?.message).toBe("Stream is not open — the message was not sent");
  });

  it("sendMessage is a no-op without a live request id or once half-closed", async () => {
    mocks.api.streamSend.mockResolvedValue(ack);
    const idle = renderHook(() => useStreamCall({ step: draft(), envName: null, onPatch: () => {} }));
    await act(() => idle.result.current.sendMessage());
    expect(mocks.api.streamSend).not.toHaveBeenCalled();

    const { result } = await openLive();
    await act(() => result.current.halfClose());
    await act(() => result.current.sendMessage());
    expect(mocks.api.streamSend).not.toHaveBeenCalled();
  });

  it("halfClose: streamHalfClose(requestId), entry half-closed but still live; End afterwards ends it as usual", async () => {
    let onEvent: (e: StreamEventIpc) => void = () => {};
    mocks.api.streamOpen.mockImplementation(async (...a: unknown[]) => {
      onEvent = a[5] as (e: StreamEventIpc) => void;
      onEvent(openedAs("client"));
    });
    const patches: Partial<Step>[] = [];
    const step = draft();
    const { result, rerender } = renderHook(
      ({ s }: { s: Step }) => useStreamCall({ step: s, envName: null, onPatch: (p) => patches.push(p) }),
      { initialProps: { s: step } },
    );
    await act(() => result.current.open("client"));
    const live = { ...step, ...patches[0] } as Step;
    rerender({ s: live });

    await act(() => result.current.halfClose());

    expect(mocks.api.streamHalfClose).toHaveBeenCalledWith(live.requestId);
    expect(streamStore.get(live.streamId!)).toMatchObject({ phase: "open", halfClosed: true });
    expect(patches).toHaveLength(1);

    act(() => onEvent(end(0)));
    expect(patches[1]).toMatchObject({ status: "ok", requestId: null });
    expect(streamStore.get(live.streamId!)).toMatchObject({ phase: "ended", halfClosed: true });
  });

  it("a rejected send followed by a successful halfClose leaves no send fault; End after that keeps it clear", async () => {
    let onEvent: (e: StreamEventIpc) => void = () => {};
    mocks.api.streamOpen.mockImplementation(async (...a: unknown[]) => {
      onEvent = a[5] as (e: StreamEventIpc) => void;
      onEvent(openedAs("bidi"));
    });
    mocks.api.streamSend.mockRejectedValue({ type: "UnresolvedVars", unresolved: ["v"], cycle: null });
    const patches: Partial<Step>[] = [];
    const step = draft();
    const { result, rerender } = renderHook(
      ({ s }: { s: Step }) => useStreamCall({ step: s, envName: null, onPatch: (p) => patches.push(p) }),
      { initialProps: { s: step } },
    );
    await act(() => result.current.open("bidi"));
    const live = { ...step, ...patches[0] } as Step;
    rerender({ s: live });

    await act(() => result.current.sendMessage());
    expect(streamStore.get(live.streamId!)!.sendFault).not.toBeNull();

    await act(() => result.current.halfClose());
    expect(streamStore.get(live.streamId!)).toMatchObject({ phase: "open", halfClosed: true, sendFault: null });

    act(() => onEvent(end(0)));
    expect(streamStore.get(live.streamId!)).toMatchObject({ phase: "ended", sendFault: null });
  });

  it("a rejected send is forgotten when the server ends the call", async () => {
    let onEvent: (e: StreamEventIpc) => void = () => {};
    mocks.api.streamOpen.mockImplementation(async (...a: unknown[]) => {
      onEvent = a[5] as (e: StreamEventIpc) => void;
      onEvent(openedAs("bidi"));
    });
    mocks.api.streamSend.mockRejectedValue({ type: "EncodeRequest", message: "expected value at line 1" });
    const patches: Partial<Step>[] = [];
    const step = draft();
    const { result, rerender } = renderHook(
      ({ s }: { s: Step }) => useStreamCall({ step: s, envName: null, onPatch: (p) => patches.push(p) }),
      { initialProps: { s: step } },
    );
    await act(() => result.current.open("bidi"));
    const live = { ...step, ...patches[0] } as Step;
    rerender({ s: live });
    await act(() => result.current.sendMessage());
    expect(streamStore.get(live.streamId!)!.sendFault?.kind).toBe("encode");

    act(() => onEvent(end(13)));
    expect(patches[1]).toMatchObject({ status: "error", requestId: null });
    expect(streamStore.get(live.streamId!)).toMatchObject({ phase: "ended", sendFault: null });
  });

  it("halfClose rejection (StreamClosed) is shown as a send fault; the entry is not marked half-closed", async () => {
    mocks.api.streamHalfClose.mockRejectedValueOnce({ type: "StreamClosed", request_id: "x" });
    const { result, live } = await openLive();
    await act(() => result.current.halfClose());
    expect(streamStore.get(live.streamId!)).toMatchObject({
      halfClosed: false, sendFault: { kind: "other", message: "Stream is not open — the message was not sent" },
    });
  });
});
