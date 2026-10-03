import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import type { StreamEventIpc } from "@/ipc/bindings";
import { streamStore } from "./streamStore";

// Deterministic animation frames: queue callbacks, flush on demand.
const frames: FrameRequestCallback[] = [];
function flushFrames() {
  const cbs = frames.splice(0);
  for (const cb of cbs) cb(performance.now());
}

const opened: StreamEventIpc = {
  type: "Opened", kind: "server", auth_used: { kind: "none" }, tls_used: true, bytes_fields: ["chunk"],
};
const headers: StreamEventIpc = { type: "Headers", metadata: { "content-type": "application/grpc" } };
const msg = (index: number, size = 10): StreamEventIpc => ({
  type: "Message", index, at_ms: 1_700_000_000_000 + index, size_bytes: size, preview: `{"i":${index}}`, json: `{ "i": ${index} }`,
});
const end = (code: number): StreamEventIpc => ({
  type: "End", status_code: code, status_message: code ? "boom" : "", status_details: [],
  trailing_metadata: { "x-t": "1" }, elapsed_ms: 1234, message_count: 2, total_bytes: 20,
});

beforeEach(() => {
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => { frames.push(cb); return frames.length; });
  vi.spyOn(Date, "now").mockReturnValue(10_000);
  streamStore.reset();
});
afterEach(() => {
  frames.length = 0;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("streamStore", () => {
  it("open creates an opening entry stamped with the request kind and openedAt", () => {
    streamStore.open("rid", "server");
    const e = streamStore.get("rid")!;
    expect(e).toMatchObject({
      id: "rid", kind: "server", phase: "opening", headers: null, messages: [], end: null,
      cancelled: false, bytesFields: [], openedAt: 10_000, elapsedMs: null, totalBytes: 0,
    });
  });

  it("batches non-terminal events per animation frame and notifies once", () => {
    streamStore.open("rid", "server");
    const listener = vi.fn();
    streamStore.subscribe(listener);
    streamStore.push("rid", opened);
    streamStore.push("rid", headers);
    streamStore.push("rid", msg(1));
    streamStore.push("rid", msg(2, 7));
    // Nothing applied before the frame.
    expect(streamStore.get("rid")!.messages).toHaveLength(0);
    expect(listener).not.toHaveBeenCalled();

    flushFrames();

    const e = streamStore.get("rid")!;
    expect(listener).toHaveBeenCalledTimes(1);
    expect(e.phase).toBe("open");
    expect(e.bytesFields).toEqual(["chunk"]);
    expect(e.authUsed).toEqual({ kind: "none" });
    expect(e.tlsUsed).toBe(true);
    expect(e.headers).toEqual({ "content-type": "application/grpc" });
    expect(e.messages.map((m) => m.index)).toEqual([1, 2]);
    expect(e.messages[0]).toEqual({ dir: "in", index: 1, atMs: 1_700_000_000_001, sizeBytes: 10, preview: '{"i":1}', json: '{ "i": 1 }' });
    expect(e.totalBytes).toBe(17);
  });

  it("End applies immediately (with anything queued before it) and freezes elapsed on the local clock", () => {
    streamStore.open("rid", "server");
    streamStore.push("rid", opened);
    streamStore.push("rid", msg(1));
    vi.mocked(Date.now).mockReturnValue(11_500);
    streamStore.push("rid", end(5));
    const e = streamStore.get("rid")!;
    expect(e.phase).toBe("ended");
    expect(e.messages).toHaveLength(1);
    // The wire's elapsed stays as data on `end`; the footer's frozen value is the SAME
    // clock the live footer ticked on (now − openedAt), so it never snaps at End.
    expect(e.end).toMatchObject({ statusCode: 5, statusMessage: "boom", trailingMetadata: { "x-t": "1" }, elapsedMs: 1234 });
    expect(e.elapsedMs).toBe(1500);
  });

  it("cancel freezes elapsed at cancel time and ignores later events", () => {
    streamStore.open("rid", "server");
    streamStore.push("rid", opened);
    streamStore.push("rid", msg(1));
    flushFrames();
    vi.mocked(Date.now).mockReturnValue(12_500);

    expect(streamStore.cancel("rid")).toBe(true);
    const e = streamStore.get("rid")!;
    expect(e).toMatchObject({ phase: "cancelled", cancelled: true, elapsedMs: 2500 });
    expect(e.messages).toHaveLength(1); // received rows stay

    streamStore.push("rid", msg(2));
    streamStore.push("rid", end(0));
    flushFrames();
    expect(streamStore.get("rid")!.messages).toHaveLength(1);
    expect(streamStore.get("rid")!.phase).toBe("cancelled");
  });

  it("cancel after End is a no-op that reports false", () => {
    streamStore.open("rid", "server");
    streamStore.push("rid", end(0));
    expect(streamStore.cancel("rid")).toBe(false);
    expect(streamStore.get("rid")!.phase).toBe("ended");
  });

  it("a post-Open Fault ends the entry with a client fault, elapsed frozen on the same local clock", () => {
    streamStore.open("rid", "server");
    vi.mocked(Date.now).mockReturnValue(10_800);
    streamStore.push("rid", { type: "Fault", error: { type: "DeadlineExceeded", timeout_ms: 30_000 } });
    const e = streamStore.get("rid")!;
    expect(e.phase).toBe("faulted");
    expect(e.fault?.kind).toBe("timeout");
    expect(e.elapsedMs).toBe(800);
  });

  it("setMessageJson caches a lazily fetched body on the row, notifies once, and is a no-op for unknown rows", () => {
    streamStore.open("rid", "server");
    streamStore.push("rid", opened);
    const big = (index: number): StreamEventIpc => ({
      type: "Message", index, at_ms: 1_700_000_000_000 + index, size_bytes: 70_000, preview: "{…", json: null,
    });
    streamStore.push("rid", big(1));
    streamStore.push("rid", big(2));
    flushFrames();
    const listener = vi.fn();
    streamStore.subscribe(listener);

    streamStore.setMessageJson("rid", 2, "{\n  \"i\": 2\n}");
    expect(listener).toHaveBeenCalledTimes(1);
    const e = streamStore.get("rid")!;
    expect(e.messages.map((m) => m.json)).toEqual([null, "{\n  \"i\": 2\n}"]);
    expect(e.messages[0]).toMatchObject({ index: 1, json: null });

    // A missing row or entry changes nothing and notifies no one.
    streamStore.setMessageJson("rid", 9, "x");
    streamStore.setMessageJson("ghost", 1, "x");
    expect(listener).toHaveBeenCalledTimes(1);
    expect(streamStore.get("rid")).toBe(e);
  });

  it("drop removes the entry and discards its queued events", () => {
    streamStore.open("rid", "server");
    streamStore.push("rid", msg(1));
    streamStore.drop("rid");
    flushFrames();
    expect(streamStore.get("rid")).toBeNull();
  });
});

describe("streamStore two-way (client / bidi) additions", () => {
  const ack = (index: number) => ({
    index, at_ms: 1_700_000_000_000 + index, size_bytes: 5 * index, preview: `{"o":${index}}`, json: `{ "o": ${index} }`,
  });

  it("open stamps halfClosed false and no send fault", () => {
    streamStore.open("rid", "bidi");
    expect(streamStore.get("rid")).toMatchObject({ kind: "bidi", halfClosed: false, sendFault: null });
  });

  it("pushOutbound appends a → row synchronously in the shared numbering, inbound bytes untouched, and clears a send fault", () => {
    streamStore.open("rid", "bidi");
    streamStore.push("rid", { ...opened, kind: "bidi" });
    flushFrames();
    streamStore.setSendFault("rid", { kind: "other", message: "Unresolved variables: {{x}}" });
    const listener = vi.fn();
    streamStore.subscribe(listener);

    streamStore.pushOutbound("rid", ack(1));
    expect(listener).toHaveBeenCalledTimes(1);
    streamStore.push("rid", msg(2));
    flushFrames();

    const e = streamStore.get("rid")!;
    expect(e.messages).toEqual([
      { dir: "out", index: 1, atMs: 1_700_000_000_001, sizeBytes: 5, preview: '{"o":1}', json: '{ "o": 1 }' },
      { dir: "in", index: 2, atMs: 1_700_000_000_002, sizeBytes: 10, preview: '{"i":2}', json: '{ "i": 2 }' },
    ]);
    expect(e.totalBytes).toBe(10);
    expect(e.sendFault).toBeNull();
  });

  it("pushOutbound on a terminal or unknown entry is a no-op", () => {
    streamStore.open("rid", "client");
    streamStore.push("rid", end(0));
    const before = streamStore.get("rid")!;
    streamStore.pushOutbound("rid", ack(1));
    streamStore.pushOutbound("ghost", ack(1));
    expect(streamStore.get("rid")).toBe(before);
    expect(before.messages).toHaveLength(0);
  });

  it("halfClose marks the live entry half-closed (phase stays live); End still ends it; terminal entries ignore it", () => {
    streamStore.open("rid", "client");
    streamStore.push("rid", { ...opened, kind: "client" });
    flushFrames();
    const listener = vi.fn();
    streamStore.subscribe(listener);

    streamStore.halfClose("rid");
    expect(listener).toHaveBeenCalledTimes(1);
    expect(streamStore.get("rid")).toMatchObject({ phase: "open", halfClosed: true });

    streamStore.push("rid", end(0));
    expect(streamStore.get("rid")).toMatchObject({ phase: "ended", halfClosed: true });

    streamStore.open("done", "client");
    streamStore.push("done", end(0));
    const before = streamStore.get("done")!;
    streamStore.halfClose("done");
    expect(streamStore.get("done")).toBe(before);
  });

  it("setSendFault stores the fault on a live entry without ending it; clearSendFault removes it; terminal entries ignore both", () => {
    streamStore.open("rid", "bidi");
    streamStore.push("rid", { ...opened, kind: "bidi" });
    flushFrames();
    const fault = { kind: "encode" as const, message: "bad json" };

    streamStore.setSendFault("rid", fault);
    expect(streamStore.get("rid")).toMatchObject({ phase: "open", sendFault: fault });

    streamStore.clearSendFault("rid");
    expect(streamStore.get("rid")!.sendFault).toBeNull();

    streamStore.push("rid", end(0));
    const before = streamStore.get("rid")!;
    streamStore.setSendFault("rid", fault);
    expect(streamStore.get("rid")).toBe(before);
  });

  it("a successful halfClose clears a pending send fault (the outbound side is over)", () => {
    streamStore.open("rid", "client");
    streamStore.push("rid", { ...opened, kind: "client" });
    flushFrames();
    streamStore.setSendFault("rid", { kind: "encode", message: "bad json" });

    streamStore.halfClose("rid");
    expect(streamStore.get("rid")).toMatchObject({ phase: "open", halfClosed: true, sendFault: null });
  });

  it.each([
    ["End", (id: string) => streamStore.push(id, end(7)), "ended"],
    ["Fault", (id: string) => streamStore.push(id, { type: "Fault", error: { type: "DeadlineExceeded", timeout_ms: 5 } }), "faulted"],
    ["cancel", (id: string) => streamStore.cancel(id), "cancelled"],
  ] as const)("%s clears a pending send fault — the strip never outlives the live call", (_name, terminate, phase) => {
    streamStore.open("rid", "bidi");
    streamStore.push("rid", { ...opened, kind: "bidi" });
    flushFrames();
    streamStore.setSendFault("rid", { kind: "other", message: "Unresolved variables: {{x}}" });
    expect(streamStore.get("rid")!.sendFault).not.toBeNull();

    terminate("rid");
    expect(streamStore.get("rid")).toMatchObject({ phase, sendFault: null });
  });
});
