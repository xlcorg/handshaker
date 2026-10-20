import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  CallRecordIpc,
  HistoryPageIpc,
  HttpResponseIpc,
  HttpSendReportIpc,
  HttpTemplateIpc,
  MethodKindIpc,
  SavedAuthConfigIpc,
  SendReportIpc,
  StreamEventIpc,
} from "@/ipc/bindings";

const mocks = vi.hoisted(() => {
  const api = {
    grpcSend: vi.fn<(...a: unknown[]) => Promise<SendReportIpc>>(),
    httpSend: vi.fn<(...a: unknown[]) => Promise<HttpSendReportIpc>>(),
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

import {
  abandonStream,
  cancelCall,
  cancelHttpCall,
  halfCloseStream,
  recordedDispatch,
  sendStreamMessage,
  type Recording,
  type RecordedDispatch,
} from "./callLifecycle";
import { streamStore } from "@/features/stream/streamStore";
import { historyStore } from "@/features/history/store";
import { newHttpStep, type HttpRun, type HttpStep } from "@/features/http/model";
import type { MethodKind } from "@/lib/method-kind";
import { workflowStore } from "./store";
import { newStep, type Step } from "./model";

const report: SendReportIpc = {
  outcome: {
    status_code: 0,
    status_message: "",
    response_json: "{}",
    trailing_metadata: {},
    status_details: [],
    elapsed_ms: 5,
  },
  auth_used: { kind: "env_var", env_var: "TOK", header_name: "authorization", prefix: "Bearer ", environments: [] },
  tls_used: true,
};
const openedAs = (kind: MethodKindIpc): StreamEventIpc => ({
  type: "Opened",
  kind,
  auth_used: { kind: "none" },
  tls_used: true,
  bytes_fields: [],
});
const end = (code: number): StreamEventIpc => ({
  type: "End",
  status_code: code,
  status_message: "",
  status_details: [],
  trailing_metadata: {},
  elapsed_ms: 50,
  message_count: 0,
  total_bytes: 0,
});
const origin = { collectionId: "c1", requestId: "r1" };

function unaryStep(): Step {
  return newStep({ address: "h:50051", service: "pkg.Svc", method: "Do" });
}

function streamStep(over: Partial<Step> = {}): Step {
  return {
    ...newStep({
      address: "{{host}}",
      tls: null,
      service: "pkg.Svc",
      method: "Watch",
      requestJson: '{"a":1}',
      metadata: [
        { key: "x", value: "1", enabled: true },
        { key: "off", value: "2", enabled: false },
      ],
    }),
    ...over,
  };
}

const grpcPatches = new Map<string, Partial<Step>[]>();
const httpRuns = new Map<string, HttpRun[]>();

function setup(
  step: Step,
  over: { envName?: string | null; kind?: MethodKind | null; recording?: Recording | null } = {},
) {
  const patches: Partial<Step>[] = [];
  grpcPatches.set(step.id, patches);
  const args: RecordedDispatch = {
    draft: step,
    envName: over.envName ?? null,
    kind: over.kind ?? null,
    recording: over.recording ?? null,
  };
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

let restoreStore: (() => void) | null = null;

beforeEach(() => {
  restoreStore?.();
  vi.clearAllMocks();
  mocks.api.streamOpen.mockReset();
  mocks.api.historyRecord.mockResolvedValue({ revision: 2, rows: [] });
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    cb(0);
    return 1;
  });
  workflowStore.reset();
  streamStore.reset();
  historyStore.reset();
  grpcPatches.clear();
  httpRuns.clear();
  const updateGrpc = workflowStore.updateGrpcDraft.bind(workflowStore);
  const setRun = workflowStore.setHttpRun.bind(workflowStore);
  const patchSpy = vi.spyOn(workflowStore, "updateGrpcDraft").mockImplementation((id, patch) => {
    grpcPatches.get(id)?.push(patch);
    updateGrpc(id, patch);
  });
  const runSpy = vi.spyOn(workflowStore, "setHttpRun").mockImplementation((id, run) => {
    httpRuns.get(id)?.push(run);
    setRun(id, run);
  });
  restoreStore = () => {
    patchSpy.mockRestore();
    runSpy.mockRestore();
  };
});
afterEach(() => {
  restoreStore?.();
  restoreStore = null;
  vi.unstubAllGlobals();
});

describe("recordedDispatch unary", () => {
  it("ok with recording: patches sending then ok, commits the step as sent with the report's auth/tls, bumps usage", async () => {
    mocks.api.grpcSend.mockResolvedValue(report);
    const step = unaryStep();
    const { args, patches } = setup(step, { envName: "dev", recording: { origin, bumpUsage: mocks.bumpUsage } });

    await recordedDispatch(args);

    expect(patches[0]).toMatchObject({ status: "sending", error: null, streamId: null });
    expect(patches[0].requestId).toBe(mocks.api.grpcSend.mock.calls[0][2]);
    expect(patches[1]).toEqual({ status: "ok", outcome: report.outcome, error: null, requestId: null });
    const [snap] = workflowStore.activeWorkflow().steps;
    expect(snap).toMatchObject({
      method: "Do",
      status: "ok",
      outcome: report.outcome,
      auth: report.auth_used,
      tls: true,
      requestId: null,
    });
    expect(snap.id).not.toBe(step.id);
    expect(mocks.bumpUsage).toHaveBeenCalledWith("c1", "r1", expect.any(Number));
  });

  it("without recording: patches, commits nothing, bumps nothing", async () => {
    mocks.api.grpcSend.mockResolvedValue(report);
    const { args, patches } = setup(unaryStep());
    await recordedDispatch(args);
    expect(patches[1]).toMatchObject({ status: "ok" });
    expect(workflowStore.activeWorkflow().steps).toHaveLength(0);
    expect(mocks.bumpUsage).not.toHaveBeenCalled();
  });

  it("recording without origin commits the snapshot and bumps nothing", async () => {
    mocks.api.grpcSend.mockResolvedValue(report);
    const { args } = setup(unaryStep(), { recording: { origin: null, bumpUsage: mocks.bumpUsage } });
    await recordedDispatch(args);
    expect(workflowStore.activeWorkflow().steps).toHaveLength(1);
    expect(mocks.bumpUsage).not.toHaveBeenCalled();
  });

  it("a failing usage bump never disturbs the call", async () => {
    mocks.api.grpcSend.mockResolvedValue(report);
    mocks.bumpUsage.mockRejectedValueOnce(new Error("offline"));
    const { args, patches } = setup(unaryStep(), { recording: { origin, bumpUsage: mocks.bumpUsage } });
    await expect(recordedDispatch(args)).resolves.toBeUndefined();
    expect(patches[1]).toMatchObject({ status: "ok" });
    expect(workflowStore.activeWorkflow().steps).toHaveLength(1);
  });

  it("unresolved variables: an error patch listing them, no snapshot", async () => {
    mocks.api.grpcSend.mockRejectedValue({ type: "UnresolvedVars", unresolved: ["host"], cycle: null });
    const { args, patches } = setup(unaryStep(), { recording: { origin, bumpUsage: mocks.bumpUsage } });
    await recordedDispatch(args);
    expect(patches[1]).toEqual({
      status: "error",
      outcome: null,
      error: { kind: "other", message: "Unresolved variables: {{host}}" },
      requestId: null,
    });
    expect(workflowStore.activeWorkflow().steps).toHaveLength(0);
  });

  it("cancelled: the step returns to draft", async () => {
    mocks.api.grpcSend.mockRejectedValue({ type: "Cancelled" });
    const { args, patches } = setup(unaryStep());
    await recordedDispatch(args);
    expect(patches[1]).toEqual({ status: "draft", outcome: null, error: null, requestId: null });
  });

  it("a step already sending does not send again", async () => {
    const { args } = setup({ ...unaryStep(), status: "sending" });
    await recordedDispatch(args);
    expect(mocks.api.grpcSend).not.toHaveBeenCalled();
  });

  it("the gate is keyed by step id: a second dispatch on the same step is inert while the first is in flight, another step runs", async () => {
    let resolve!: (r: SendReportIpc) => void;
    mocks.api.grpcSend.mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
    mocks.api.grpcSend.mockResolvedValue(report);
    const step = unaryStep();
    const first = recordedDispatch(setup(step).args);
    await recordedDispatch(setup(step).args);
    expect(mocks.api.grpcSend).toHaveBeenCalledTimes(1);
    await recordedDispatch(setup(unaryStep()).args);
    expect(mocks.api.grpcSend).toHaveBeenCalledTimes(2);
    resolve(report);
    await first;
    await recordedDispatch(setup(step).args);
    expect(mocks.api.grpcSend).toHaveBeenCalledTimes(3);
  });

  it("cancelCall forwards the in-flight request id to grpcCancel", async () => {
    await cancelCall({ step: { ...unaryStep(), requestId: "rid-1" } });
    expect(mocks.api.grpcCancel).toHaveBeenCalledWith("rid-1");
  });
});

describe("recordedDispatch stream", () => {
  it("open: registers the entry at the attempt's start, patches sending + streamId, calls streamOpen with draft/ctx/kind/opts", async () => {
    openResolves();
    vi.spyOn(Date, "now").mockReturnValue(1_700_000_000_000);
    const { args, patches } = setup(streamStep({ collectionId: "c1" }), { envName: "dev", kind: "server" });

    await recordedDispatch(args);
    vi.mocked(Date.now).mockRestore();

    expect(patches[0]).toMatchObject({ status: "sending", error: null, outcome: null });
    const id = patches[0].requestId!;
    expect(patches[0].streamId).toBe(id);
    expect(streamStore.get(id)).toMatchObject({ phase: "open", openedAt: 1_700_000_000_000 });
    const [d, ctx, rid, kind, opts] = mocks.api.streamOpen.mock.calls[0];
    expect(d).toEqual({
      address_template: "{{host}}",
      tls_override: null,
      service: "pkg.Svc",
      method: "Watch",
      body_template: '{"a":1}',
      metadata: [
        { key: "x", value: "1", enabled: true },
        { key: "off", value: "2", enabled: false },
      ],
      auth: { kind: "none" },
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
    await recordedDispatch(args);
    events()(end(0));

    expect(patches[1]).toEqual({ status: "ok", error: null, requestId: null });
    const [snap] = workflowStore.activeWorkflow().steps;
    expect(snap).toMatchObject({
      status: "ok",
      streamId: patches[0].streamId,
      tls: true,
      auth: { kind: "none" },
      requestId: null,
      outcome: null,
    });
    expect(snap.id).not.toBe(step.id);
    expect(mocks.bumpUsage).toHaveBeenCalledWith("c1", "r1", expect.any(Number));
  });

  it("End non-OK: error with no client fault; nothing committed without recording", async () => {
    const events = openResolves();
    const { args, patches } = setup(streamStep(), { kind: "server" });
    await recordedDispatch(args);
    events()(end(5));
    expect(patches[1]).toEqual({ status: "error", error: null, requestId: null });
    expect(workflowStore.activeWorkflow().steps).toHaveLength(0);
  });

  it("a Fault after Open puts the client fault on the step and keeps the faulted entry", async () => {
    const events = openResolves();
    const { args, patches } = setup(streamStep(), { kind: "server" });
    await recordedDispatch(args);
    events()({ type: "Fault", error: { type: "DeadlineExceeded", timeout_ms: 30_000 } });
    expect(patches[1]).toEqual({
      status: "error",
      requestId: null,
      error: { kind: "timeout", message: "Request timed out after 30000ms" },
    });
    expect(streamStore.get(patches[0].streamId!)?.phase).toBe("faulted");
  });

  it("cancel after Open: grpcCancel, the entry freezes, status cancelled", async () => {
    openResolves();
    const { args, patches, current } = setup(streamStep(), { kind: "server" });
    await recordedDispatch(args);
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
    await recordedDispatch(args);

    await cancelCall({ step: { ...current(), requestJson: '{"edited":true}' } });

    const [snap] = workflowStore.activeWorkflow().steps;
    expect(snap).toMatchObject({ status: "cancelled", requestJson: '{"a":1}' });
  });

  it("a Cancel before Open: patched cancelled, no snapshot", async () => {
    mocks.api.streamOpen.mockImplementation(() => new Promise(() => {}));
    const { args, patches, current } = setup(streamStep(), {
      kind: "server",
      recording: { origin, bumpUsage: mocks.bumpUsage },
    });
    void recordedDispatch(args);
    await Promise.resolve();

    await cancelCall({ step: current() });

    expect(patches[1]).toEqual({ status: "cancelled", error: null, requestId: null });
    expect(workflowStore.activeWorkflow().steps).toHaveLength(0);
    expect(mocks.bumpUsage).not.toHaveBeenCalled();
  });

  it("a rejection before Open: the client fault, streamId cleared, entry dropped", async () => {
    mocks.api.streamOpen.mockRejectedValue({ type: "DeadlineExceeded", timeout_ms: 30_000 });
    const { args, patches } = setup(streamStep(), { kind: "server" });
    await recordedDispatch(args);
    expect(patches[1]).toMatchObject({ status: "error", requestId: null, streamId: null, error: { kind: "timeout" } });
    expect(streamStore.get(patches[0].streamId!)).toBeNull();
  });

  it("unresolved variables before Open wear the unary message; a sending step does not open again", async () => {
    mocks.api.streamOpen.mockRejectedValue({ type: "UnresolvedVars", unresolved: ["host"], cycle: null });
    const { args, patches } = setup(streamStep(), { kind: "server" });
    await recordedDispatch(args);
    expect(patches[1]).toMatchObject({
      status: "error",
      error: { kind: "other", message: "Unresolved variables: {{host}}" },
    });

    await recordedDispatch(setup(streamStep({ status: "sending" }), { kind: "server" }).args);
    expect(mocks.api.streamOpen).toHaveBeenCalledTimes(1);
  });

  it("abandonStream settles a live stream without a patch; a later End is ignored", async () => {
    const events = openResolves();
    const { args, patches } = setup(streamStep(), {
      kind: "server",
      recording: { origin, bumpUsage: mocks.bumpUsage },
    });
    await recordedDispatch(args);
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
    address_template: "{{host}}",
    tls_override: null,
    service: "pkg.Svc",
    method: "Watch",
    body_template: '{"a":1}',
    metadata: [
      { key: "x", value: "1", enabled: true },
      { key: "off", value: "2", enabled: false },
    ],
    auth: { kind: "none" },
  };
  const status = (code: number, message = "") => ({ code, message, trailers: {} });

  it("a unary status, OK or not, is one record each, of the request as authored", async () => {
    clockAtT0();
    mocks.api.grpcSend
      .mockResolvedValueOnce(report)
      .mockResolvedValueOnce({
        ...report,
        outcome: { ...report.outcome, status_code: 5, status_message: "gone", response_json: null },
      });

    await recordedDispatch(setup(streamStep(), { recording: recording() }).args);
    await recordedDispatch(setup(streamStep(), { recording: recording() }).args);

    expect(recorded()).toEqual([
      {
        id: mocks.api.grpcSend.mock.calls[0][2],
        started_at_ms: T0,
        origin: { collection_id: "c1", request_id: "r1" },
        call: {
          protocol: "grpc",
          request: authoredRequest,
          outcome: { type: "unary", status: status(0), response: { type: "inline", json: "{}" } },
        },
        elapsed_ms: 5,
      },
      {
        id: mocks.api.grpcSend.mock.calls[1][2],
        started_at_ms: T0,
        origin: { collection_id: "c1", request_id: "r1" },
        call: {
          protocol: "grpc",
          request: authoredRequest,
          outcome: { type: "unary", status: status(5, "gone"), response: { type: "absent" } },
        },
        elapsed_ms: 5,
      },
    ]);
  });

  it("a unary fault is a unary_fault record timed from the attempt's start", async () => {
    clockAtT0();
    mocks.api.grpcSend.mockImplementationOnce(async () => {
      now += 40;
      throw { type: "DeadlineExceeded", timeout_ms: 30_000 };
    });
    await recordedDispatch(setup(streamStep(), { recording: { origin: null, bumpUsage: mocks.bumpUsage } }).args);
    expect(recorded()).toEqual([
      {
        id: mocks.api.grpcSend.mock.calls[0][2],
        started_at_ms: T0,
        origin: null,
        call: {
          protocol: "grpc",
          request: authoredRequest,
          outcome: { type: "unary_fault", fault: { kind: "timeout", message: "Request timed out after 30000ms" } },
        },
        elapsed_ms: 40,
      },
    ]);
  });

  it("a unary cancel and an in-place send are never recorded", async () => {
    mocks.api.grpcSend.mockRejectedValueOnce({ type: "Cancelled" }).mockResolvedValueOnce(report);
    await recordedDispatch(setup(unaryStep(), { recording: recording() }).args);
    await recordedDispatch(setup(unaryStep()).args);
    expect(mocks.api.grpcSend).toHaveBeenCalledTimes(2);
    expect(recorded()).toEqual([]);
  });

  it("a kind mismatch is not recorded; the re-routed attempt records once", async () => {
    mocks.api.grpcSend.mockRejectedValue({
      type: "MethodKindMismatch",
      service: "pkg.Svc",
      method: "Watch",
      expected: "unary",
      actual: "server",
    });
    const events = openResolves();
    await recordedDispatch(setup(streamStep(), { kind: "unary", recording: recording() }).args);
    events()(end(0));
    expect(recorded()).toHaveLength(1);
    expect(recorded()[0]).toMatchObject({
      id: mocks.api.streamOpen.mock.calls[0][2],
      call: { protocol: "grpc", outcome: { type: "stream", kind: "server" } },
    });
  });

  it("a stream End records headers, messages and status, started at the entry's openedAt", async () => {
    clockAtT0();
    const events = openResolves();
    const { args, patches } = setup(streamStep(), { kind: "server", recording: recording() });
    await recordedDispatch(args);
    const id = patches[0].streamId!;
    events()({ type: "Headers", metadata: { "content-type": "application/grpc" } });
    events()({ type: "Message", index: 1, at_ms: T0 + 10, size_bytes: 7, preview: '{"n":1}', json: '{"n":1}' });
    events()(end(0));

    expect(streamStore.get(id)!.openedAt).toBe(T0);
    expect(recorded()).toEqual([
      {
        id,
        started_at_ms: T0,
        origin: { collection_id: "c1", request_id: "r1" },
        call: {
          protocol: "grpc",
          request: authoredRequest,
          outcome: {
            type: "stream",
            kind: "server",
            headers: { "content-type": "application/grpc" },
            messages: [
              { direction: "in", index: 1, at_ms: T0 + 10, size_bytes: 7, preview: '{"n":1}', json: '{"n":1}' },
            ],
            omitted_messages: 0,
            end: { type: "status", status: status(0) },
          },
        },
        elapsed_ms: 0,
      },
    ]);
  });

  it("a Fault after Open records the fault; a Cancel after Open records cancelled with no headers", async () => {
    const events = openResolves();
    await recordedDispatch(setup(streamStep(), { kind: "server", recording: recording() }).args);
    events()({ type: "Fault", error: { type: "DeadlineExceeded", timeout_ms: 30_000 } });

    const second = setup(streamStep(), { kind: "server", recording: recording() });
    await recordedDispatch(second.args);
    await cancelCall({ step: second.current() });

    expect(recorded().map((r) => r.call.outcome)).toEqual([
      expect.objectContaining({
        headers: null,
        end: { type: "fault", fault: { kind: "timeout", message: "Request timed out after 30000ms" } },
      }),
      expect.objectContaining({ headers: null, end: { type: "cancelled" } }),
    ]);
  });

  it("a Cancel before Open and an abandon while opening are never recorded", async () => {
    mocks.api.streamOpen.mockImplementation(() => new Promise(() => {}));
    const first = setup(streamStep(), { kind: "server", recording: recording() });
    void recordedDispatch(first.args);
    await Promise.resolve();
    await cancelCall({ step: first.current() });

    const second = setup(streamStep(), { kind: "server", recording: recording() });
    void recordedDispatch(second.args);
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
    await recordedDispatch(args);
    expect(recorded()).toEqual([
      {
        id: patches[0].streamId,
        started_at_ms: T0,
        origin: { collection_id: "c1", request_id: "r1" },
        call: {
          protocol: "grpc",
          request: authoredRequest,
          outcome: { type: "stream_refused", kind: "bidi", fault: { kind: "refused", message: "connection refused" } },
        },
        elapsed_ms: 12,
      },
    ]);
  });

  it("abandonStream records a live opened stream as cancelled once; a later End adds nothing", async () => {
    const events = openResolves();
    const { args, patches } = setup(streamStep(), { kind: "server", recording: recording() });
    await recordedDispatch(args);
    abandonStream(patches[0].streamId!);
    events()(end(0));
    expect(recorded()).toHaveLength(1);
    expect(recorded()[0].call.outcome).toMatchObject({ type: "stream", end: { type: "cancelled" } });
  });

  it("an in-place stream is never recorded", async () => {
    const events = openResolves();
    await recordedDispatch(setup(streamStep(), { kind: "server" }).args);
    events()(end(0));
    expect(recorded()).toEqual([]);
  });

  it("a refused record leaves the call finished in the editor", async () => {
    mocks.api.historyRecord.mockRejectedValue({ type: "Persistence", message: "too large" });
    mocks.api.grpcSend.mockResolvedValue(report);
    const { args, patches } = setup(unaryStep(), { recording: recording() });
    await expect(recordedDispatch(args)).resolves.toBeUndefined();
    expect(patches[1]).toMatchObject({ status: "ok" });
    expect(workflowStore.activeWorkflow().steps).toHaveLength(1);
  });
});

describe("recordedDispatch http", () => {
  const T0 = 1_700_000_000_000;
  let now = T0;
  beforeEach(() => {
    now = T0;
    vi.spyOn(Date, "now").mockImplementation(() => now);
  });
  afterEach(() => vi.mocked(Date.now).mockRestore());

  const template: HttpTemplateIpc = {
    method: "POST",
    url_template: "{{base}}/users",
    query: [],
    headers: [{ key: "accept", value: "application/json", enabled: true }],
    body: { kind: "json", text: '{"name":"{{name}}"}' },
    auth: { kind: "env_var", env_var: "TOK", header_name: "authorization", prefix: "Bearer " },
  };
  const response: HttpResponseIpc = {
    status: 503,
    reason: "Service Unavailable",
    headers: [],
    body: { type: "text", text: "down" },
    size_bytes: 4,
    elapsed_ms: 21,
  };
  const authUsed: SavedAuthConfigIpc = {
    kind: "env_var",
    env_var: "TOK",
    header_name: "authorization",
    prefix: "Bearer ",
    environments: [],
  };
  const recorded = () => mocks.api.historyRecord.mock.calls.map(([r]) => r);

  function httpSetup(
    draft: HttpStep = newHttpStep({ template, collectionId: "c1" }),
    over: { recording?: Recording | null } = {},
  ) {
    const runs: HttpRun[] = [];
    httpRuns.set(draft.id, runs);
    const args: RecordedDispatch = { draft, envName: "dev", kind: null, recording: over.recording ?? null };
    return { args, runs };
  }

  it("a response, even a 5xx, is a done run, one snapshot, a usage bump and one record of the template as authored", async () => {
    mocks.api.httpSend.mockResolvedValue({ response, auth_used: authUsed });
    const { args, runs } = httpSetup(undefined, { recording: { origin, bumpUsage: mocks.bumpUsage } });

    await recordedDispatch(args);

    const [sent, ctx, rid, opts] = mocks.api.httpSend.mock.calls[0];
    expect(sent).toEqual(template);
    expect(ctx).toEqual({ collection_id: "c1", env_name: "dev" });
    expect(opts).toMatchObject({ timeout_ms: expect.any(Number), max_message_bytes: expect.any(Number) });
    expect(runs).toEqual([
      { status: "sending", requestId: rid },
      { status: "done", response, authUsed },
    ]);
    const [snap] = workflowStore.activeWorkflow().steps;
    expect(snap).toEqual({ ...args.draft, id: expect.any(String), run: { status: "done", response, authUsed } });
    expect(snap.id).not.toBe(args.draft.id);
    expect(mocks.bumpUsage).toHaveBeenCalledWith("c1", "r1", expect.any(Number));
    expect(recorded()).toEqual([
      {
        id: rid,
        started_at_ms: T0,
        origin: { collection_id: "c1", request_id: "r1" },
        elapsed_ms: 21,
        call: { protocol: "http", request: template, outcome: { type: "response", response } },
      },
    ]);
  });

  it("an invalid URL is an error run and a fault record timed from the start, with no snapshot", async () => {
    mocks.api.httpSend.mockImplementationOnce(async () => {
      now += 30;
      throw { type: "InvalidUrl", problem: { type: "missing_scheme" } };
    });
    const { args, runs } = httpSetup(undefined, { recording: { origin: null, bumpUsage: mocks.bumpUsage } });

    await recordedDispatch(args);

    const error = { kind: "other", message: "Invalid URL: start it with http:// or https://" };
    expect(runs[1]).toEqual({ status: "error", error });
    expect(workflowStore.activeWorkflow().steps).toHaveLength(0);
    expect(mocks.bumpUsage).not.toHaveBeenCalled();
    expect(recorded()).toEqual([
      {
        id: mocks.api.httpSend.mock.calls[0][2],
        started_at_ms: T0,
        origin: null,
        elapsed_ms: 30,
        call: { protocol: "http", request: template, outcome: { type: "fault", fault: error } },
      },
    ]);
  });

  it("a cancel returns the draft to idle and is never recorded", async () => {
    mocks.api.httpSend.mockRejectedValue({ type: "Cancelled" });
    const { args, runs } = httpSetup(undefined, { recording: { origin, bumpUsage: mocks.bumpUsage } });
    await recordedDispatch(args);
    expect(runs[1]).toEqual({ status: "draft" });
    expect(recorded()).toEqual([]);
    expect(workflowStore.activeWorkflow().steps).toHaveLength(0);
  });

  it("an in-place send (no recording) sets the run and records nothing", async () => {
    mocks.api.httpSend.mockResolvedValue({ response, auth_used: authUsed });
    const { args, runs } = httpSetup();
    await recordedDispatch(args);
    expect(runs[1]).toEqual({ status: "done", response, authUsed });
    expect(recorded()).toEqual([]);
    expect(workflowStore.activeWorkflow().steps).toHaveLength(0);
  });

  it("a draft already sending does not send again, and cancelHttpCall forwards its request id", async () => {
    const sending = { ...newHttpStep({ template }), run: { status: "sending", requestId: "rid-h" } } as const;
    await recordedDispatch(httpSetup(sending).args);
    expect(mocks.api.httpSend).not.toHaveBeenCalled();
    await cancelHttpCall(sending);
    expect(mocks.api.grpcCancel).toHaveBeenCalledWith("rid-h");
  });
});

describe("two-way streams (client / bidi)", () => {
  const pretty = '{\n  "a": 1\n}';
  const ack = { index: 1, at_ms: 1_700_000_000_001, size_bytes: 9, preview: '{"a":1}', json: pretty };

  async function openLive(kind: MethodKindIpc = "bidi", over: Partial<Step> = {}) {
    const events = openResolves();
    const { args, patches, current } = setup(streamStep({ collectionId: "c1", ...over }), { envName: "dev", kind });
    await recordedDispatch(args);
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

    expect(mocks.api.streamSend).toHaveBeenCalledWith(live.requestId, '{"a":"{{v}}"}', {
      collection_id: "c1",
      env_name: "dev",
    });
    const e = streamStore.get(live.streamId!)!;
    expect(e.messages).toEqual([
      { dir: "out", index: 1, atMs: 1_700_000_000_001, sizeBytes: 9, preview: '{"a":1}', json: pretty },
    ]);
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
      phase: "open",
      messages: [],
      sendFault: { kind: "encode", message: "expected value at line 1" },
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
      halfClosed: false,
      sendFault: { kind: "other", message: "Stream is not open — the message was not sent" },
    });
  });
});

describe("one-shot re-route on a kind mismatch", () => {
  const mismatch = (expected: MethodKindIpc, actual: MethodKindIpc) => ({
    type: "MethodKindMismatch" as const,
    service: "pkg.Svc",
    method: "M",
    expected,
    actual,
  });

  it("null kind on a server method: the refused unary send opens that stream once, with no error in between", async () => {
    mocks.api.grpcSend.mockRejectedValue(mismatch("unary", "server"));
    openResolves();
    const { args, patches } = setup(unaryStep(), { kind: null, recording: { origin, bumpUsage: mocks.bumpUsage } });

    await recordedDispatch(args);

    expect(mocks.api.grpcSend).toHaveBeenCalledTimes(1);
    expect(mocks.api.streamOpen).toHaveBeenCalledTimes(1);
    expect(mocks.api.streamOpen.mock.calls[0][3]).toBe("server");
    expect(patches.every((p) => p.status !== "error")).toBe(true);
    const last = patches.at(-1)!;
    expect(last).toMatchObject({ status: "sending", error: null });
    expect(last.streamId).toBe(last.requestId);
    expect(streamStore.get(last.streamId!)).toMatchObject({ phase: "open", kind: "server" });
  });

  it("a stale server kind on a bidi method opens again as bidi and drops the refused entry", async () => {
    mocks.api.streamOpen
      .mockRejectedValueOnce(mismatch("server", "bidi"))
      .mockImplementationOnce(async (...a: unknown[]) => {
        (a[5] as (e: StreamEventIpc) => void)(openedAs("bidi"));
      });
    const { args, patches } = setup(streamStep(), { kind: "server" });

    await recordedDispatch(args);

    expect(mocks.api.streamOpen.mock.calls.map((c) => c[3])).toEqual(["server", "bidi"]);
    expect(mocks.api.grpcSend).not.toHaveBeenCalled();
    const last = patches.at(-1)!;
    expect(last).toMatchObject({ status: "sending" });
    expect(streamStore.get(last.streamId!)).toMatchObject({ phase: "open", kind: "bidi" });
    expect(streamStore.get(patches[0].streamId!)).toBeNull();
  });

  it("a unary method opened as a stream falls back to grpcSend and completes as unary", async () => {
    mocks.api.streamOpen.mockRejectedValue(mismatch("server", "unary"));
    mocks.api.grpcSend.mockResolvedValue(report);
    const { args, patches } = setup(streamStep(), {
      kind: "server",
      recording: { origin, bumpUsage: mocks.bumpUsage },
    });

    await recordedDispatch(args);

    expect(mocks.api.streamOpen).toHaveBeenCalledTimes(1);
    expect(mocks.api.grpcSend).toHaveBeenCalledTimes(1);
    expect(patches.at(-1)).toMatchObject({ status: "ok", outcome: report.outcome, requestId: null });
    expect(patches.some((p) => p.status === "sending" && p.streamId === null)).toBe(true);
    expect(workflowStore.activeWorkflow().steps[0]).toMatchObject({ status: "ok", streamId: null });
  });

  it("a second mismatch is an error on the draft, with no snapshot, no credit, and no history row", async () => {
    mocks.api.grpcSend.mockRejectedValue(mismatch("unary", "server"));
    mocks.api.streamOpen.mockRejectedValue(mismatch("server", "bidi"));
    const { args, patches } = setup(unaryStep(), { kind: null, recording: { origin, bumpUsage: mocks.bumpUsage } });

    await recordedDispatch(args);

    expect(mocks.api.grpcSend).toHaveBeenCalledTimes(1);
    expect(mocks.api.streamOpen).toHaveBeenCalledTimes(1);
    expect(patches.at(-1)).toMatchObject({
      status: "error",
      requestId: null,
      streamId: null,
      outcome: null,
      error: { kind: "kind_mismatch", mismatch: { expected: "server", actual: "bidi" } },
    });
    expect(workflowStore.activeWorkflow().steps).toHaveLength(0);
    expect(mocks.bumpUsage).not.toHaveBeenCalled();
    expect(mocks.api.historyRecord).not.toHaveBeenCalled();
  });

  it("cancel between the refusal and the retry wins: no second IPC call, the draft leaves sending", async () => {
    let refuse!: (e: unknown) => void;
    mocks.api.grpcSend.mockImplementation(
      () =>
        new Promise((_, rej) => {
          refuse = rej;
        }),
    );
    openResolves();
    const { args, patches, current } = setup(unaryStep());

    const sending = recordedDispatch(args);
    await cancelCall({ step: current() });
    refuse(mismatch("unary", "server"));
    await sending;

    expect(mocks.api.grpcSend).toHaveBeenCalledTimes(1);
    expect(mocks.api.streamOpen).not.toHaveBeenCalled();
    expect(patches.at(-1)).toMatchObject({ status: "draft", requestId: null, streamId: null, error: null });
    expect(workflowStore.activeWorkflow().steps).toHaveLength(0);
  });

  it("a cancel before send does not poison the next send", async () => {
    mocks.api.grpcSend.mockRejectedValue(mismatch("unary", "server"));
    openResolves();
    const step = unaryStep();
    await cancelCall({ step });
    const { args, patches } = setup(step);

    await recordedDispatch(args);

    expect(mocks.api.streamOpen).toHaveBeenCalledTimes(1);
    expect(patches.at(-1)).toMatchObject({ status: "sending" });
  });
});

describe("recorded finish across protocols", () => {
  const recording = () => ({ origin, bumpUsage: mocks.bumpUsage });
  const httpTemplate: HttpTemplateIpc = {
    method: "GET",
    url_template: "https://example.test/ping",
    query: [],
    headers: [],
    body: { kind: "none" },
    auth: { kind: "none" },
  };
  const httpResponse: HttpResponseIpc = {
    status: 200,
    reason: "OK",
    headers: [],
    body: { type: "text", text: "pong" },
    size_bytes: 4,
    elapsed_ms: 9,
  };

  it("a recorded success commits one snapshot, credits usage once, and appends one history row for unary, HTTP, and a server stream", async () => {
    mocks.api.grpcSend.mockResolvedValue(report);
    const events = openResolves();
    mocks.api.httpSend.mockResolvedValue({ response: httpResponse, auth_used: { kind: "none" } });

    await recordedDispatch(setup(unaryStep(), { recording: recording() }).args);
    await recordedDispatch(setup(streamStep(), { kind: "server", recording: recording() }).args);
    events()(end(0));
    const httpDraft = newHttpStep({ template: httpTemplate, collectionId: "c1" });
    await recordedDispatch({ draft: httpDraft, envName: "dev", kind: null, recording: recording() });

    expect(workflowStore.activeWorkflow().steps).toHaveLength(3);
    expect(mocks.bumpUsage).toHaveBeenCalledTimes(3);
    expect(mocks.api.historyRecord).toHaveBeenCalledTimes(3);
    expect(mocks.api.historyRecord.mock.calls.map(([r]) => r.call.protocol)).toEqual(["grpc", "grpc", "http"]);
  });

  it("a recorded client fault appends one history row and does not commit or credit, for unary, HTTP, and a stream refused before open", async () => {
    mocks.api.grpcSend.mockRejectedValue({ type: "DeadlineExceeded", timeout_ms: 30_000 });
    mocks.api.httpSend.mockRejectedValue({ type: "InvalidUrl", problem: { type: "missing_scheme" } });
    mocks.api.streamOpen.mockRejectedValue({ type: "Transport", kind: "Refused", message: "connection refused" });

    await recordedDispatch(setup(unaryStep(), { recording: recording() }).args);
    await recordedDispatch({
      draft: newHttpStep({ template: httpTemplate }),
      envName: "dev",
      kind: null,
      recording: recording(),
    });
    await recordedDispatch(setup(streamStep(), { kind: "server", recording: recording() }).args);

    expect(workflowStore.activeWorkflow().steps).toHaveLength(0);
    expect(mocks.bumpUsage).not.toHaveBeenCalled();
    expect(mocks.api.historyRecord).toHaveBeenCalledTimes(3);
  });

  it("an opened stream that faults credits usage; a unary fault does not", async () => {
    const events = openResolves();
    await recordedDispatch(setup(streamStep(), { kind: "server", recording: recording() }).args);
    events()({ type: "Fault", error: { type: "DeadlineExceeded", timeout_ms: 30_000 } });
    mocks.api.grpcSend.mockRejectedValue({ type: "DeadlineExceeded", timeout_ms: 30_000 });
    await recordedDispatch(setup(unaryStep(), { recording: recording() }).args);

    expect(mocks.bumpUsage).toHaveBeenCalledTimes(1);
    expect(workflowStore.activeWorkflow().steps).toHaveLength(1);
    expect(mocks.api.historyRecord).toHaveBeenCalledTimes(2);
  });
});
