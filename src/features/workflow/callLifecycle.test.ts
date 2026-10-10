import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CallRecordIpc, HistoryPageIpc, MethodKindIpc, SendReportIpc, StreamEventIpc } from "@/ipc/bindings";

const mocks = vi.hoisted(() => {
  const api = {
    grpcSend: vi.fn<(...a: unknown[]) => Promise<SendReportIpc>>(),
    grpcCancel: vi.fn<(id: string) => Promise<void>>().mockResolvedValue(undefined),
    streamOpen: vi.fn<(...a: unknown[]) => Promise<void>>(),
    streamSend: vi.fn<(...a: unknown[]) => Promise<unknown>>(),
    streamHalfClose: vi.fn<(id: string) => Promise<void>>().mockResolvedValue(undefined),
    streamRelease: vi.fn().mockResolvedValue(undefined),
    envActiveSet: vi.fn().mockResolvedValue(undefined),
    historyRecord: vi.fn<(r: CallRecordIpc) => Promise<HistoryPageIpc>>(),
  };
  return { api, bumpUsage: vi.fn<(...a: unknown[]) => Promise<unknown>>(() => Promise.resolve()) };
});
vi.mock("@/ipc/client", () => ({ ...mocks.api, ipc: mocks.api }));

import { abandonStream, cancelCall, halfCloseStream, runCall, sendStreamMessage, type CallArgs } from "./callLifecycle";
import { streamStore } from "@/features/stream/streamStore";
import { historyStore } from "@/features/history/store";
import { workflowStore } from "./store";
import { newStep, type Step } from "./model";

const report: SendReportIpc = {
  outcome: { status_code: 0, status_message: "", response_json: "{}", trailing_metadata: {}, status_details: [], elapsed_ms: 5 },
  auth_used: { kind: "env_var", env_var: "TOK", header_name: "authorization", prefix: "Bearer ", environments: [] },
  tls_used: true,
};
const openedAs = (kind: MethodKindIpc): StreamEventIpc => ({
  type: "Opened", kind, auth_used: { kind: "none" }, tls_used: true, bytes_fields: [],
});
const end = (code: number): StreamEventIpc => ({
  type: "End", status_code: code, status_message: "", status_details: [], trailing_metadata: {},
  elapsed_ms: 50, message_count: 0, total_bytes: 0,
});
const origin = { collectionId: "c1", requestId: "r1" };

function unaryStep(): Step {
  return newStep({ address: "h:50051", service: "pkg.Svc", method: "Do" });
}

function streamStep(over: Partial<Step> = {}): Step {
  return {
    ...newStep({ address: "{{host}}", tls: null, service: "pkg.Svc", method: "Watch", requestJson: '{"a":1}',
      metadata: [{ key: "x", value: "1", enabled: true }, { key: "off", value: "2", enabled: false }] }),
    ...over,
  };
}

function setup(step: Step, over: Partial<CallArgs> = {}) {
  const patches: Partial<Step>[] = [];
  const args: CallArgs = { step, envName: null, kind: null, onPatch: (p) => patches.push(p), recording: null, ...over };
  const current = (): Step => Object.assign({}, step, ...patches);
  return { args, patches, current };
}

function openResolves() {
  let onEvent: ((e: StreamEventIpc) => void) | null = null;
  mocks.api.streamOpen.mockImplementation(async (...a: unknown[]) => {
    onEvent = a[5] as (e: StreamEventIpc) => void;
    onEvent(openedAs(a[3] as MethodKindIpc));
  });
  return () => onEvent!;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.api.streamOpen.mockReset();
  mocks.api.historyRecord.mockResolvedValue({ revision: 2, rows: [] });
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => { cb(0); return 1; });
  workflowStore.reset();
  streamStore.reset();
  historyStore.reset();
});
afterEach(() => vi.unstubAllGlobals());

describe("runCall unary", () => {
  it("ok with recording: patches sending then ok, commits the step as sent with the report's auth/tls, bumps usage", async () => {
    mocks.api.grpcSend.mockResolvedValue(report);
    const step = unaryStep();
    const { args, patches } = setup(step, { envName: "dev", recording: { origin, bumpUsage: mocks.bumpUsage } });

    await runCall(args);

    expect(patches[0]).toMatchObject({ status: "sending", error: null, streamId: null });
    expect(patches[0].requestId).toBe(mocks.api.grpcSend.mock.calls[0][2]);
    expect(patches[1]).toEqual({ status: "ok", outcome: report.outcome, error: null, requestId: null });
    const [snap] = workflowStore.activeWorkflow().steps;
    expect(snap).toMatchObject({ method: "Do", status: "ok", outcome: report.outcome, auth: report.auth_used, tls: true, requestId: null });
    expect(snap.id).not.toBe(step.id);
    expect(mocks.bumpUsage).toHaveBeenCalledWith("c1", "r1", expect.any(Number));
  });

  it("without recording (an in-place List/Ledger send): patches, commits nothing, bumps nothing", async () => {
    mocks.api.grpcSend.mockResolvedValue(report);
    const { args, patches } = setup(unaryStep());
    await runCall(args);
    expect(patches[1]).toMatchObject({ status: "ok" });
    expect(workflowStore.activeWorkflow().steps).toHaveLength(0);
    expect(mocks.bumpUsage).not.toHaveBeenCalled();
  });

  it("recording without origin commits the snapshot and bumps nothing", async () => {
    mocks.api.grpcSend.mockResolvedValue(report);
    const { args } = setup(unaryStep(), { recording: { origin: null, bumpUsage: mocks.bumpUsage } });
    await runCall(args);
    expect(workflowStore.activeWorkflow().steps).toHaveLength(1);
    expect(mocks.bumpUsage).not.toHaveBeenCalled();
  });

  it("a failing usage bump never disturbs the call", async () => {
    mocks.api.grpcSend.mockResolvedValue(report);
    mocks.bumpUsage.mockRejectedValueOnce(new Error("offline"));
    const { args, patches } = setup(unaryStep(), { recording: { origin, bumpUsage: mocks.bumpUsage } });
    await expect(runCall(args)).resolves.toBeUndefined();
    expect(patches[1]).toMatchObject({ status: "ok" });
    expect(workflowStore.activeWorkflow().steps).toHaveLength(1);
  });

  it("unresolved variables: an error patch listing them, no snapshot", async () => {
    mocks.api.grpcSend.mockRejectedValue({ type: "UnresolvedVars", unresolved: ["host"], cycle: null });
    const { args, patches } = setup(unaryStep(), { recording: { origin, bumpUsage: mocks.bumpUsage } });
    await runCall(args);
    expect(patches[1]).toEqual({
      status: "error", outcome: null, error: { kind: "other", message: "Unresolved variables: {{host}}" }, requestId: null,
    });
    expect(workflowStore.activeWorkflow().steps).toHaveLength(0);
  });

  it("cancelled: the step returns to draft", async () => {
    mocks.api.grpcSend.mockRejectedValue({ type: "Cancelled" });
    const { args, patches } = setup(unaryStep());
    await runCall(args);
    expect(patches[1]).toEqual({ status: "draft", outcome: null, error: null, requestId: null });
  });

  it("a step already sending does not send again", async () => {
    const { args } = setup({ ...unaryStep(), status: "sending" });
    await runCall(args);
    expect(mocks.api.grpcSend).not.toHaveBeenCalled();
  });

  it("the gate is keyed by step id: a second runCall on the same step is inert while the first is in flight, another step runs", async () => {
    let resolve!: (r: SendReportIpc) => void;
    mocks.api.grpcSend.mockImplementationOnce(() => new Promise((r) => { resolve = r; }));
    mocks.api.grpcSend.mockResolvedValue(report);
    const step = unaryStep();
    const first = runCall(setup(step).args);
    await runCall(setup(step).args);
    expect(mocks.api.grpcSend).toHaveBeenCalledTimes(1);
    await runCall(setup(unaryStep()).args);
    expect(mocks.api.grpcSend).toHaveBeenCalledTimes(2);
    resolve(report);
    await first;
    await runCall(setup(step).args);
    expect(mocks.api.grpcSend).toHaveBeenCalledTimes(3);
  });

  it("cancelCall forwards the in-flight request id to grpcCancel", async () => {
    await cancelCall({ step: { ...unaryStep(), requestId: "rid-1" } });
    expect(mocks.api.grpcCancel).toHaveBeenCalledWith("rid-1");
  });
});

describe("runCall stream", () => {
  it("open: registers the entry at the attempt's start, patches sending + streamId, calls streamOpen with draft/ctx/kind/opts", async () => {
    openResolves();
    vi.spyOn(Date, "now").mockReturnValue(1_700_000_000_000);
    const { args, patches } = setup(streamStep({ collectionId: "c1" }), { envName: "dev", kind: "server" });

    await runCall(args);
    vi.mocked(Date.now).mockRestore();

    expect(patches[0]).toMatchObject({ status: "sending", error: null, outcome: null });
    const id = patches[0].requestId!;
    expect(patches[0].streamId).toBe(id);
    expect(streamStore.get(id)).toMatchObject({ phase: "open", openedAt: 1_700_000_000_000 });
    const [d, ctx, rid, kind, opts] = mocks.api.streamOpen.mock.calls[0];
    expect(d).toEqual({
      address_template: "{{host}}", tls_override: null, service: "pkg.Svc", method: "Watch", body_template: '{"a":1}',
      metadata: [{ key: "x", value: "1", enabled: true }], auth: { kind: "none" },
    });
    expect(ctx).toEqual({ collection_id: "c1", env_name: "dev" });
    expect(rid).toBe(id);
    expect(kind).toBe("server");
    expect(opts).toMatchObject({ timeout_ms: expect.any(Number), max_message_bytes: expect.any(Number) });
    expect(patches).toHaveLength(1);
  });

  it("End OK with recording: ok, the snapshot carries the stream id and Opened's auth/tls, usage bumped", async () => {
    const events = openResolves();
    const step = streamStep();
    const { args, patches } = setup(step, { kind: "server", recording: { origin, bumpUsage: mocks.bumpUsage } });
    await runCall(args);
    events()(end(0));

    expect(patches[1]).toEqual({ status: "ok", error: null, requestId: null });
    const [snap] = workflowStore.activeWorkflow().steps;
    expect(snap).toMatchObject({ status: "ok", streamId: patches[0].streamId, tls: true, auth: { kind: "none" }, requestId: null, outcome: null });
    expect(snap.id).not.toBe(step.id);
    expect(mocks.bumpUsage).toHaveBeenCalledWith("c1", "r1", expect.any(Number));
  });

  it("End non-OK: error with no client fault; nothing committed without recording", async () => {
    const events = openResolves();
    const { args, patches } = setup(streamStep(), { kind: "server" });
    await runCall(args);
    events()(end(5));
    expect(patches[1]).toEqual({ status: "error", error: null, requestId: null });
    expect(workflowStore.activeWorkflow().steps).toHaveLength(0);
  });

  it("a Fault after Open puts the client fault on the step and keeps the faulted entry", async () => {
    const events = openResolves();
    const { args, patches } = setup(streamStep(), { kind: "server" });
    await runCall(args);
    events()({ type: "Fault", error: { type: "DeadlineExceeded", timeout_ms: 30_000 } });
    expect(patches[1]).toEqual({
      status: "error", requestId: null, error: { kind: "timeout", message: "Request timed out after 30000ms" },
    });
    expect(streamStore.get(patches[0].streamId!)?.phase).toBe("faulted");
  });

  it("cancel after Open: grpcCancel, the entry freezes, status cancelled", async () => {
    openResolves();
    const { args, patches, current } = setup(streamStep(), { kind: "server" });
    await runCall(args);
    const live = current();

    await cancelCall({ step: live });

    expect(mocks.api.grpcCancel).toHaveBeenCalledWith(live.requestId);
    expect(streamStore.get(live.streamId!)).toMatchObject({ phase: "cancelled", cancelled: true });
    expect(streamStore.get(live.streamId!)!.elapsedMs).not.toBeNull();
    expect(patches[1]).toEqual({ status: "cancelled", error: null, requestId: null });
  });

  it("a Cancel settles with the Open-time step, not the step it was called with", async () => {
    openResolves();
    const step = streamStep();
    const { args, current } = setup(step, { kind: "server", recording: { origin: null, bumpUsage: mocks.bumpUsage } });
    await runCall(args);

    await cancelCall({ step: { ...current(), requestJson: '{"edited":true}' } });

    const [snap] = workflowStore.activeWorkflow().steps;
    expect(snap).toMatchObject({ status: "cancelled", requestJson: '{"a":1}' });
  });

  it("a Cancel before Open: patched cancelled, no snapshot", async () => {
    mocks.api.streamOpen.mockImplementation(() => new Promise(() => {}));
    const { args, patches, current } = setup(streamStep(), { kind: "server", recording: { origin, bumpUsage: mocks.bumpUsage } });
    void runCall(args);
    await Promise.resolve();

    await cancelCall({ step: current() });

    expect(patches[1]).toEqual({ status: "cancelled", error: null, requestId: null });
    expect(workflowStore.activeWorkflow().steps).toHaveLength(0);
    expect(mocks.bumpUsage).not.toHaveBeenCalled();
  });

  it("a rejection before Open: the client fault, streamId cleared, entry dropped", async () => {
    mocks.api.streamOpen.mockRejectedValue({ type: "DeadlineExceeded", timeout_ms: 30_000 });
    const { args, patches } = setup(streamStep(), { kind: "server" });
    await runCall(args);
    expect(patches[1]).toMatchObject({ status: "error", requestId: null, streamId: null, error: { kind: "timeout" } });
    expect(streamStore.get(patches[0].streamId!)).toBeNull();
  });

  it("unresolved variables before Open wear the unary message; a sending step does not open again", async () => {
    mocks.api.streamOpen.mockRejectedValue({ type: "UnresolvedVars", unresolved: ["host"], cycle: null });
    const { args, patches } = setup(streamStep(), { kind: "server" });
    await runCall(args);
    expect(patches[1]).toMatchObject({ status: "error", error: { kind: "other", message: "Unresolved variables: {{host}}" } });

    await runCall(setup(streamStep({ status: "sending" }), { kind: "server" }).args);
    expect(mocks.api.streamOpen).toHaveBeenCalledTimes(1);
  });

  it("abandonStream settles a live stream without a patch; a later End is ignored", async () => {
    const events = openResolves();
    const { args, patches } = setup(streamStep(), { kind: "server", recording: { origin, bumpUsage: mocks.bumpUsage } });
    await runCall(args);
    const id = patches[0].streamId!;

    abandonStream(id);
    events()(end(0));

    expect(patches).toHaveLength(1);
    expect(streamStore.get(id)?.phase).toBe("cancelled");
    expect(workflowStore.activeWorkflow().steps).toHaveLength(0);
    expect(mocks.bumpUsage).not.toHaveBeenCalled();
  });
});

describe("call records", () => {
  const T0 = 1_700_000_000_000;
  let now = T0;
  let clock: { mockRestore(): void } | null = null;
  function clockAtT0() {
    now = T0;
    clock = vi.spyOn(Date, "now").mockImplementation(() => now);
  }
  afterEach(() => {
    clock?.mockRestore();
    clock = null;
  });

  const recording = () => ({ origin, bumpUsage: mocks.bumpUsage });
  const recorded = () => mocks.api.historyRecord.mock.calls.map(([r]) => r);
  const authoredRequest = {
    address_template: "{{host}}", tls_override: null, service: "pkg.Svc", method: "Watch", body_template: '{"a":1}',
    metadata: [{ key: "x", value: "1", enabled: true }, { key: "off", value: "2", enabled: false }],
    auth: { kind: "none" },
  };
  const status = (code: number, message = "") => ({ code, message, trailers: {} });

  it("a unary status, OK or not, is one record each, of the request as authored", async () => {
    clockAtT0();
    mocks.api.grpcSend
      .mockResolvedValueOnce(report)
      .mockResolvedValueOnce({ ...report, outcome: { ...report.outcome, status_code: 5, status_message: "gone", response_json: null } });

    await runCall(setup(streamStep(), { recording: recording() }).args);
    await runCall(setup(streamStep(), { recording: recording() }).args);

    expect(recorded()).toEqual([
      {
        id: mocks.api.grpcSend.mock.calls[0][2], started_at_ms: T0, origin: { collection_id: "c1", request_id: "r1" },
        request: authoredRequest, elapsed_ms: 5,
        outcome: { type: "unary", status: status(0), response: { type: "inline", json: "{}" } },
      },
      {
        id: mocks.api.grpcSend.mock.calls[1][2], started_at_ms: T0, origin: { collection_id: "c1", request_id: "r1" },
        request: authoredRequest, elapsed_ms: 5,
        outcome: { type: "unary", status: status(5, "gone"), response: { type: "absent" } },
      },
    ]);
  });

  it("a unary fault is a unary_fault record timed from the attempt's start", async () => {
    clockAtT0();
    mocks.api.grpcSend.mockImplementationOnce(async () => {
      now += 40;
      throw { type: "DeadlineExceeded", timeout_ms: 30_000 };
    });
    await runCall(setup(streamStep(), { recording: { origin: null, bumpUsage: mocks.bumpUsage } }).args);
    expect(recorded()).toEqual([
      {
        id: mocks.api.grpcSend.mock.calls[0][2], started_at_ms: T0, origin: null, request: authoredRequest, elapsed_ms: 40,
        outcome: { type: "unary_fault", fault: { kind: "timeout", message: "Request timed out after 30000ms" } },
      },
    ]);
  });

  it("a unary cancel and an in-place send are never recorded", async () => {
    mocks.api.grpcSend.mockRejectedValueOnce({ type: "Cancelled" }).mockResolvedValueOnce(report);
    await runCall(setup(unaryStep(), { recording: recording() }).args);
    await runCall(setup(unaryStep()).args);
    expect(mocks.api.grpcSend).toHaveBeenCalledTimes(2);
    expect(recorded()).toEqual([]);
  });

  it("a kind mismatch is not recorded; the re-routed attempt records once", async () => {
    mocks.api.grpcSend.mockRejectedValue({
      type: "MethodKindMismatch", service: "pkg.Svc", method: "Watch", expected: "unary", actual: "server",
    });
    const events = openResolves();
    await runCall(setup(streamStep(), { kind: "unary", recording: recording() }).args);
    events()(end(0));
    expect(recorded()).toHaveLength(1);
    expect(recorded()[0]).toMatchObject({ id: mocks.api.streamOpen.mock.calls[0][2], outcome: { type: "stream", kind: "server" } });
  });

  it("a stream End records headers, messages and status, started at the entry's openedAt", async () => {
    clockAtT0();
    const events = openResolves();
    const { args, patches } = setup(streamStep(), { kind: "server", recording: recording() });
    await runCall(args);
    const id = patches[0].streamId!;
    events()({ type: "Headers", metadata: { "content-type": "application/grpc" } });
    events()({ type: "Message", index: 1, at_ms: T0 + 10, size_bytes: 7, preview: '{"n":1}', json: '{"n":1}' });
    events()(end(0));

    expect(streamStore.get(id)!.openedAt).toBe(T0);
    expect(recorded()).toEqual([
      {
        id, started_at_ms: T0, origin: { collection_id: "c1", request_id: "r1" }, request: authoredRequest, elapsed_ms: 0,
        outcome: {
          type: "stream", kind: "server", headers: { "content-type": "application/grpc" },
          messages: [{ direction: "in", index: 1, at_ms: T0 + 10, size_bytes: 7, preview: '{"n":1}', json: '{"n":1}' }],
          omitted_messages: 0, end: { type: "status", status: status(0) },
        },
      },
    ]);
  });

  it("a Fault after Open records the fault; a Cancel after Open records cancelled with no headers", async () => {
    const events = openResolves();
    await runCall(setup(streamStep(), { kind: "server", recording: recording() }).args);
    events()({ type: "Fault", error: { type: "DeadlineExceeded", timeout_ms: 30_000 } });

    const second = setup(streamStep(), { kind: "server", recording: recording() });
    await runCall(second.args);
    await cancelCall({ step: second.current() });

    expect(recorded().map((r) => r.outcome)).toEqual([
      expect.objectContaining({ headers: null, end: { type: "fault", fault: { kind: "timeout", message: "Request timed out after 30000ms" } } }),
      expect.objectContaining({ headers: null, end: { type: "cancelled" } }),
    ]);
  });

  it("a Cancel before Open and an abandon while opening are never recorded", async () => {
    mocks.api.streamOpen.mockImplementation(() => new Promise(() => {}));
    const first = setup(streamStep(), { kind: "server", recording: recording() });
    void runCall(first.args);
    await Promise.resolve();
    await cancelCall({ step: first.current() });

    const second = setup(streamStep(), { kind: "server", recording: recording() });
    void runCall(second.args);
    await Promise.resolve();
    abandonStream(second.patches[0].streamId!);

    expect(recorded()).toEqual([]);
  });

  it("a refusal before Open is a stream_refused record of the asked kind", async () => {
    clockAtT0();
    mocks.api.streamOpen.mockImplementation(async () => {
      now += 12;
      throw { type: "Transport", kind: "Refused", message: "connection refused" };
    });
    const { args, patches } = setup(streamStep(), { kind: "bidi", recording: recording() });
    await runCall(args);
    expect(recorded()).toEqual([
      {
        id: patches[0].streamId, started_at_ms: T0, origin: { collection_id: "c1", request_id: "r1" },
        request: authoredRequest, elapsed_ms: 12,
        outcome: { type: "stream_refused", kind: "bidi", fault: { kind: "refused", message: "connection refused" } },
      },
    ]);
  });

  it("abandonStream records a live opened stream as cancelled once; a later End adds nothing", async () => {
    const events = openResolves();
    const { args, patches } = setup(streamStep(), { kind: "server", recording: recording() });
    await runCall(args);
    abandonStream(patches[0].streamId!);
    events()(end(0));
    expect(recorded()).toHaveLength(1);
    expect(recorded()[0].outcome).toMatchObject({ type: "stream", end: { type: "cancelled" } });
  });

  it("an in-place stream is never recorded", async () => {
    const events = openResolves();
    await runCall(setup(streamStep(), { kind: "server" }).args);
    events()(end(0));
    expect(recorded()).toEqual([]);
  });

  it("a refused record leaves the call finished in the editor", async () => {
    mocks.api.historyRecord.mockRejectedValue({ type: "Persistence", message: "too large" });
    mocks.api.grpcSend.mockResolvedValue(report);
    const { args, patches } = setup(unaryStep(), { recording: recording() });
    await expect(runCall(args)).resolves.toBeUndefined();
    expect(patches[1]).toMatchObject({ status: "ok" });
    expect(workflowStore.activeWorkflow().steps).toHaveLength(1);
  });
});

describe("two-way streams (client / bidi)", () => {
  const pretty = '{\n  "a": 1\n}';
  const ack = { index: 1, at_ms: 1_700_000_000_001, size_bytes: 9, preview: '{"a":1}', json: pretty };

  async function openLive(kind: MethodKindIpc = "bidi", over: Partial<Step> = {}) {
    const events = openResolves();
    const { args, patches, current } = setup(streamStep({ collectionId: "c1", ...over }), { envName: "dev", kind });
    await runCall(args);
    return { live: current(), patches, events };
  }

  it("open with kind client/bidi passes the kind through and sends nothing itself", async () => {
    const { live } = await openLive();
    expect(mocks.api.streamOpen.mock.calls[0][3]).toBe("bidi");
    expect(mocks.api.streamSend).not.toHaveBeenCalled();
    expect(streamStore.get(live.streamId!)).toMatchObject({ phase: "open", kind: "bidi", halfClosed: false });
  });

  it("sendStreamMessage: streamSend(requestId, current body template, ctx of this moment), the ack becomes a → row", async () => {
    mocks.api.streamSend.mockResolvedValue(ack);
    const { live } = await openLive();

    await sendStreamMessage({ step: { ...live, requestJson: '{"a":"{{v}}"}' }, envName: "dev" });

    expect(mocks.api.streamSend).toHaveBeenCalledWith(live.requestId, '{"a":"{{v}}"}', { collection_id: "c1", env_name: "dev" });
    const e = streamStore.get(live.streamId!)!;
    expect(e.messages).toEqual([{ dir: "out", index: 1, atMs: 1_700_000_000_001, sizeBytes: 9, preview: '{"a":1}', json: pretty }]);
    expect(e.phase).toBe("open");
    expect(e.sendFault).toBeNull();
  });

  it("a send rejected for unresolved variables lands on the entry; the stream stays open and the step unpatched", async () => {
    mocks.api.streamSend.mockRejectedValue({ type: "UnresolvedVars", unresolved: ["v"], cycle: null });
    const { live, patches } = await openLive();
    await sendStreamMessage({ step: live, envName: "dev" });
    const e = streamStore.get(live.streamId!)!;
    expect(e.phase).toBe("open");
    expect(e.messages).toHaveLength(0);
    expect(e.sendFault).toEqual({ kind: "other", message: "Unresolved variables: {{v}}" });
    expect(patches).toHaveLength(1);
  });

  it("a send rejected as EncodeRequest is an encode fault on the entry, nothing pushed", async () => {
    mocks.api.streamSend.mockRejectedValue({ type: "EncodeRequest", message: "expected value at line 1" });
    const { live } = await openLive();
    await sendStreamMessage({ step: live, envName: "dev" });
    expect(streamStore.get(live.streamId!)).toMatchObject({
      phase: "open", messages: [], sendFault: { kind: "encode", message: "expected value at line 1" },
    });
  });

  it("a send rejected as StreamClosed shows the user-facing message, never the discriminator", async () => {
    mocks.api.streamSend.mockRejectedValue({ type: "StreamClosed", request_id: "x" });
    const { live } = await openLive();
    await sendStreamMessage({ step: live, envName: "dev" });
    expect(streamStore.get(live.streamId!)!.sendFault?.message).toBe("Stream is not open — the message was not sent");
  });

  it("sendStreamMessage is a no-op without a live request id or once half-closed", async () => {
    mocks.api.streamSend.mockResolvedValue(ack);
    await sendStreamMessage({ step: streamStep(), envName: null });
    expect(mocks.api.streamSend).not.toHaveBeenCalled();

    const { live } = await openLive();
    await halfCloseStream({ step: live });
    await sendStreamMessage({ step: live, envName: "dev" });
    expect(mocks.api.streamSend).not.toHaveBeenCalled();
  });

  it("halfCloseStream: streamHalfClose(requestId), entry half-closed but live; a later End ends it as usual", async () => {
    const { live, patches, events } = await openLive("client");

    await halfCloseStream({ step: live });

    expect(mocks.api.streamHalfClose).toHaveBeenCalledWith(live.requestId);
    expect(streamStore.get(live.streamId!)).toMatchObject({ phase: "open", halfClosed: true });
    expect(patches).toHaveLength(1);
    events()(end(0));
    expect(patches[1]).toEqual({ status: "ok", error: null, requestId: null });
    expect(streamStore.get(live.streamId!)).toMatchObject({ phase: "ended", halfClosed: true });
  });

  it("a rejected send followed by a successful half-close leaves no send fault; End keeps it clear", async () => {
    mocks.api.streamSend.mockRejectedValue({ type: "UnresolvedVars", unresolved: ["v"], cycle: null });
    const { live, events } = await openLive();
    await sendStreamMessage({ step: live, envName: "dev" });
    expect(streamStore.get(live.streamId!)!.sendFault).not.toBeNull();

    await halfCloseStream({ step: live });
    expect(streamStore.get(live.streamId!)).toMatchObject({ phase: "open", halfClosed: true, sendFault: null });
    events()(end(0));
    expect(streamStore.get(live.streamId!)).toMatchObject({ phase: "ended", sendFault: null });
  });

  it("a rejected send is forgotten when the server ends the call", async () => {
    mocks.api.streamSend.mockRejectedValue({ type: "EncodeRequest", message: "expected value at line 1" });
    const { live, patches, events } = await openLive();
    await sendStreamMessage({ step: live, envName: "dev" });
    expect(streamStore.get(live.streamId!)!.sendFault?.kind).toBe("encode");

    events()(end(13));
    expect(patches[1]).toEqual({ status: "error", error: null, requestId: null });
    expect(streamStore.get(live.streamId!)).toMatchObject({ phase: "ended", sendFault: null });
  });

  it("a half-close rejected as StreamClosed is a send fault; the entry is not marked half-closed", async () => {
    mocks.api.streamHalfClose.mockRejectedValueOnce({ type: "StreamClosed", request_id: "x" });
    const { live } = await openLive();
    await halfCloseStream({ step: live });
    expect(streamStore.get(live.streamId!)).toMatchObject({
      halfClosed: false, sendFault: { kind: "other", message: "Stream is not open — the message was not sent" },
    });
  });
});
