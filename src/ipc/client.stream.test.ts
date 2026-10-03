import { describe, it, expect, vi, beforeEach } from "vitest";
import type {
  AssembleResultIpc,
  IpcError,
  MethodKindIpc,
  StreamEventIpc,
  OutboundMessageIpc,
  SendCtxIpc,
  SendDraftIpc,
  CallOptionsIpc,
} from "./bindings";

// The bindings' `TAURI_CHANNEL` IS `@tauri-apps/api/core`'s `Channel`; mock it so the
// facade's channel can be driven by the test (no webview).
const channelMock = vi.hoisted(() => ({
  instances: [] as Array<{ onmessage: (e: unknown) => void }>,
}));
vi.mock("@tauri-apps/api/core", () => ({
  Channel: class {
    onmessage: (e: unknown) => void;
    constructor(onmessage?: (e: unknown) => void) {
      this.onmessage = onmessage ?? (() => {});
      channelMock.instances.push(this);
    }
  },
}));
vi.mock("./bindings", () => ({
  commands: {
    streamOpen: vi.fn(),
    streamSend: vi.fn(),
    streamHalfClose: vi.fn(),
    streamRelease: vi.fn(),
    streamMessage: vi.fn(),
    streamSaveMessages: vi.fn(),
    streamAssemble: vi.fn(),
    grpcCancel: vi.fn(),
  },
}));

import { commands } from "./bindings";
import {
  streamOpen,
  streamSend,
  streamHalfClose,
  streamRelease,
  streamMessage,
  streamSaveMessages,
  streamAssemble,
  grpcCancel,
  ipc,
} from "./client";

const draft: SendDraftIpc = {
  address_template: "{{host}}",
  tls_override: null,
  service: "pkg.Svc",
  method: "Watch",
  body_template: "{}",
  metadata: [],
  auth: { kind: "none" },
};
const ctx: SendCtxIpc = { collection_id: null, env_name: "dev" };
const opts: CallOptionsIpc = { timeout_ms: 30_000, max_message_bytes: 0 };

// TS fixtures for every DTO the stream path introduces — `tsc` checks the shapes.
const kinds: MethodKindIpc[] = ["unary", "server", "client", "bidi"];
const events: StreamEventIpc[] = [
  {
    type: "Opened",
    kind: "server",
    auth_used: { kind: "none" },
    tls_used: false,
    bytes_fields: [],
  },
  { type: "Headers", metadata: { "content-type": "application/grpc" } },
  {
    type: "Message",
    index: 1,
    at_ms: 1_700_000_000_000,
    size_bytes: 12,
    preview: '{"id":"a"}',
    json: '{\n  "id": "a"\n}',
  },
  { type: "Message", index: 2, at_ms: 1_700_000_000_001, size_bytes: 70_000, preview: "{…", json: null },
  {
    type: "End",
    status_code: 0,
    status_message: "OK",
    status_details: [],
    trailing_metadata: {},
    elapsed_ms: 42,
    message_count: 2,
    total_bytes: 70_012,
  },
  { type: "Fault", error: { type: "DeadlineExceeded", timeout_ms: 30_000 } },
];
// The kind gate's rejection — `expected` is the path used, `actual` the descriptor's kind.
const kindMismatch: IpcError = {
  type: "MethodKindMismatch",
  service: "pkg.Svc",
  method: "Watch",
  expected: "unary",
  actual: "server",
};
// The Send message ack: Message meta (shared numbering) + the resolved JSON on the wire.
const outbound: OutboundMessageIpc = {
  index: 3,
  at_ms: 1_700_000_000_002,
  size_bytes: 9,
  preview: '{"id":"a"}',
  json: '{\n  "id": "a"\n}',
};

// What `stream_assemble` reports after a saved file: counts as u32, size as f64.
const assembled: AssembleResultIpc = { path: "C:\\out\\logo.png", written: 2, total: 3, size_bytes: 5_000_000_000 };
// The export refusals — the store is gone, or the path is not a bytes candidate.
const exportErrors: IpcError[] = [
  { type: "StreamNotFound", request_id: "rid" },
  { type: "StreamFieldNotFound", request_id: "rid", field_path: "chunk.data" },
];

beforeEach(() => {
  vi.clearAllMocks();
  channelMock.instances.length = 0;
});

describe("streamSaveMessages / streamAssemble", () => {
  it("resolve to the saved path / result, and to null when the dialog was cancelled", async () => {
    vi.mocked(commands.streamSaveMessages).mockResolvedValue({ status: "ok", data: "/out/response.json" });
    await expect(streamSaveMessages("rid")).resolves.toBe("/out/response.json");
    expect(commands.streamSaveMessages).toHaveBeenCalledWith("rid");
    vi.mocked(commands.streamSaveMessages).mockResolvedValue({ status: "ok", data: null });
    await expect(ipc.streamSaveMessages("rid")).resolves.toBeNull();

    vi.mocked(commands.streamAssemble).mockResolvedValue({ status: "ok", data: assembled });
    await expect(streamAssemble("rid", "data")).resolves.toEqual(assembled);
    expect(commands.streamAssemble).toHaveBeenCalledWith("rid", "data");
    vi.mocked(commands.streamAssemble).mockResolvedValue({ status: "ok", data: null });
    await expect(ipc.streamAssemble("rid", "data")).resolves.toBeNull();
  });

  it("reject with the structured export errors", async () => {
    vi.mocked(commands.streamSaveMessages).mockResolvedValue({ status: "error", error: exportErrors[0] });
    await expect(streamSaveMessages("rid")).rejects.toEqual({ type: "StreamNotFound", request_id: "rid" });
    vi.mocked(commands.streamAssemble).mockResolvedValue({ status: "error", error: exportErrors[1] });
    await expect(streamAssemble("rid", "chunk.data")).rejects.toEqual({
      type: "StreamFieldNotFound",
      request_id: "rid",
      field_path: "chunk.data",
    });
  });
});

describe("streamOpen", () => {
  it("wraps the handler in one Channel per call, forwards kind + opts, resolves at Opened", async () => {
    vi.mocked(commands.streamOpen).mockResolvedValue({ status: "ok", data: null });
    const seen: StreamEventIpc[] = [];

    await streamOpen(draft, ctx, "rid", "server", opts, (e) => seen.push(e));

    expect(commands.streamOpen).toHaveBeenCalledTimes(1);
    const [d, c, id, kind, o, channel] = vi.mocked(commands.streamOpen).mock.calls[0];
    expect([d, c, id, kind, o]).toEqual([draft, ctx, "rid", "server", opts]);
    expect(channelMock.instances).toHaveLength(1);
    expect(channel).toBe(channelMock.instances[0]);

    // Events delivered on the channel reach the handler in order, unchanged.
    for (const ev of events) channelMock.instances[0].onmessage(ev);
    expect(seen).toEqual(events);
    expect(kinds).toHaveLength(4);
  });

  it("rejects with the structured MethodKindMismatch when the kind disagrees with the contract", async () => {
    vi.mocked(commands.streamOpen).mockResolvedValue({
      status: "error",
      error: { ...kindMismatch, expected: "server", actual: "bidi" },
    });
    await expect(streamOpen(draft, ctx, "rid", "server", opts, () => {})).rejects.toEqual({
      type: "MethodKindMismatch",
      service: "pkg.Svc",
      method: "Watch",
      expected: "server",
      actual: "bidi",
    });
  });

  it("rejects with the IpcError for a pre-Open fault", async () => {
    vi.mocked(commands.streamOpen).mockResolvedValue({
      status: "error",
      error: { type: "UnresolvedVars", unresolved: ["host"], cycle: null },
    });
    await expect(streamOpen(draft, ctx, "rid", "server", opts, () => {})).rejects.toEqual({
      type: "UnresolvedVars",
      unresolved: ["host"],
      cycle: null,
    });
  });
});

describe("streamMessage", () => {
  it("forwards (requestId, index) and unwraps the pretty JSON", async () => {
    vi.mocked(commands.streamMessage).mockResolvedValue({ status: "ok", data: '{\n  "id": "b"\n}' });
    await expect(streamMessage("rid", 2)).resolves.toBe('{\n  "id": "b"\n}');
    expect(commands.streamMessage).toHaveBeenCalledWith("rid", 2);
  });

  it("rejects with the typed IpcError for an unknown id / index", async () => {
    vi.mocked(commands.streamMessage).mockResolvedValue({
      status: "error",
      error: { type: "StreamMessageNotFound", request_id: "rid", index: 9 },
    });
    await expect(streamMessage("rid", 9)).rejects.toEqual({ type: "StreamMessageNotFound", request_id: "rid", index: 9 });
  });
});

describe("streamSend", () => {
  it("forwards (requestId, bodyTemplate, ctx) — templates intact — and unwraps the ack", async () => {
    vi.mocked(commands.streamSend).mockResolvedValue({ status: "ok", data: outbound });
    await expect(streamSend("rid", '{"id":"{{who}}"}', ctx)).resolves.toEqual(outbound);
    expect(commands.streamSend).toHaveBeenCalledWith("rid", '{"id":"{{who}}"}', ctx);
  });

  it("rejects with StreamClosed after half-close / before Opened, and with UnresolvedVars for a bad body", async () => {
    vi.mocked(commands.streamSend).mockResolvedValueOnce({
      status: "error",
      error: { type: "StreamClosed", request_id: "rid" },
    });
    await expect(streamSend("rid", "{}", ctx)).rejects.toEqual({ type: "StreamClosed", request_id: "rid" });

    vi.mocked(commands.streamSend).mockResolvedValueOnce({
      status: "error",
      error: { type: "UnresolvedVars", unresolved: ["who"], cycle: null },
    });
    await expect(streamSend("rid", '{"id":"{{who}}"}', ctx)).rejects.toEqual({
      type: "UnresolvedVars",
      unresolved: ["who"],
      cycle: null,
    });
  });
});

describe("streamHalfClose", () => {
  it("forwards the request id and resolves to void", async () => {
    vi.mocked(commands.streamHalfClose).mockResolvedValue({ status: "ok", data: null });
    await expect(streamHalfClose("rid")).resolves.toBeUndefined();
    expect(commands.streamHalfClose).toHaveBeenCalledWith("rid");
  });

  it("rejects with StreamClosed for an unknown id", async () => {
    vi.mocked(commands.streamHalfClose).mockResolvedValue({
      status: "error",
      error: { type: "StreamClosed", request_id: "ghost" },
    });
    await expect(streamHalfClose("ghost")).rejects.toEqual({ type: "StreamClosed", request_id: "ghost" });
  });
});

describe("streamRelease / grpcCancel", () => {
  it("streamRelease forwards the request id", async () => {
    vi.mocked(commands.streamRelease).mockResolvedValue({ status: "ok", data: null });
    await streamRelease("rid");
    expect(commands.streamRelease).toHaveBeenCalledWith("rid");
  });

  it("grpcCancel stays the single cancel entry point", async () => {
    vi.mocked(commands.grpcCancel).mockResolvedValue({ status: "ok", data: null });
    await grpcCancel("rid");
    expect(commands.grpcCancel).toHaveBeenCalledWith("rid");
  });

  it("the ipc object exposes the stream facade (two-shape mock contract)", () => {
    expect(ipc.streamOpen).toBe(streamOpen);
    expect(ipc.streamSend).toBe(streamSend);
    expect(ipc.streamHalfClose).toBe(streamHalfClose);
    expect(ipc.streamRelease).toBe(streamRelease);
    expect(ipc.streamMessage).toBe(streamMessage);
  });
});
