import { describe, expect, it } from "vitest";
import type { MessageMeta, StreamEntry } from "@/features/stream/streamStore";
import { newStep } from "@/features/workflow/model";
import { buildRecord, streamKindOf } from "./record";

const step = newStep({ address: "h:1", service: "s.v1.S", method: "M" });
const start = { id: "call-1", step, startedAt: 1_700_000_000_000.5, origin: null };

function entry(over: Partial<StreamEntry>): StreamEntry {
  return {
    id: "call-1", kind: "server", phase: "ended", halfClosed: false, sendFault: null, headers: null, messages: [],
    end: null, cancelled: false, fault: null, bytesFields: [], authUsed: null, tlsUsed: null, openedAt: 0,
    elapsedMs: 0, totalBytes: 0, ...over,
  };
}

describe("buildRecord", () => {
  it("passes a large unary body and every stream message through whole", () => {
    const body = "x".repeat(600 * 1024);
    const unary = buildRecord(start, {
      type: "unary",
      outcome: { status_code: 0, status_message: "", response_json: body, trailing_metadata: {}, status_details: [], elapsed_ms: 1 },
    });
    expect(unary.outcome).toMatchObject({ response: { type: "inline", json: body } });

    const messages: MessageMeta[] = Array.from({ length: 300 }, (_, i) => ({
      dir: "in", index: i + 1, atMs: i, sizeBytes: 2, preview: "{}", json: "{}",
    }));
    const stream = buildRecord(start, { type: "stream", entry: entry({ messages }), elapsedMs: 1 });
    expect(stream.outcome).toMatchObject({ omitted_messages: 0 });
    expect(stream.outcome.type === "stream" && stream.outcome.messages.length).toBe(300);
  });

  it("clamps integers to u32 and keeps epoch ms as they are", () => {
    const negative = buildRecord(start, { type: "unary_fault", fault: { kind: "other", message: "x" }, elapsedMs: -3 });
    const fractional = buildRecord(start, { type: "unary_fault", fault: { kind: "other", message: "x" }, elapsedMs: 7.6 });
    const huge = buildRecord(start, {
      type: "stream",
      entry: entry({ messages: [{ dir: "out", index: 2 ** 40, atMs: 1.5, sizeBytes: 2 ** 33, preview: "", json: null }] }),
      elapsedMs: 2 ** 34,
    });
    expect(negative.elapsed_ms).toBe(0);
    expect(fractional.elapsed_ms).toBe(8);
    expect(huge.elapsed_ms).toBe(4_294_967_295);
    expect(huge.started_at_ms).toBe(1_700_000_000_000.5);
    expect(huge.outcome.type === "stream" && huge.outcome.messages[0]).toEqual({
      direction: "out", index: 4_294_967_295, at_ms: 1.5, size_bytes: 4_294_967_295, preview: "", json: null,
    });
  });

  it("streamKindOf refuses unary", () => {
    expect(streamKindOf("client")).toBe("client");
    expect(() => streamKindOf("unary")).toThrow();
  });
});
