import { describe, expect, it } from "vitest";
import type { HttpResponseIpc } from "@/ipc/bindings";
import type { MessageMeta, StreamEntry } from "@/features/stream/streamStore";
import { newStep } from "@/features/workflow/model";
import { newHttpStep } from "@/features/http/model";
import { buildHttpRecord, buildRecord, streamKindOf } from "./record";

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
  it("records the step as authored inside a gRPC call", () => {
    const authored = newStep({
      address: "{{host}}:443",
      tls: null,
      service: "s.v1.S",
      method: "M",
      requestJson: '{"id":"{{id}}"}',
      metadata: [
        { key: "x-on", value: "1", enabled: true },
        { key: "x-off", value: "2", enabled: false },
      ],
      auth: { kind: "env_var", env_var: "TOK", header_name: "authorization", prefix: "Bearer " },
    });
    const record = buildRecord(
      { id: "call-2", step: authored, startedAt: 5, origin: { collectionId: "c1", requestId: "r1" } },
      { type: "unary_fault", fault: { kind: "refused", message: "connection refused" }, elapsedMs: 3 },
    );
    expect(record).toEqual({
      id: "call-2",
      started_at_ms: 5,
      origin: { collection_id: "c1", request_id: "r1" },
      elapsed_ms: 3,
      call: {
        protocol: "grpc",
        request: {
          address_template: "{{host}}:443",
          tls_override: null,
          service: "s.v1.S",
          method: "M",
          body_template: '{"id":"{{id}}"}',
          metadata: [
            { key: "x-on", value: "1", enabled: true },
            { key: "x-off", value: "2", enabled: false },
          ],
          auth: { kind: "env_var", env_var: "TOK", header_name: "authorization", prefix: "Bearer " },
        },
        outcome: { type: "unary_fault", fault: { kind: "refused", message: "connection refused" } },
      },
    });
  });

  it("passes a large unary body and every stream message through whole", () => {
    const body = "x".repeat(600 * 1024);
    const unary = buildRecord(start, {
      type: "unary",
      outcome: { status_code: 0, status_message: "", response_json: body, trailing_metadata: {}, status_details: [], elapsed_ms: 1 },
    });
    expect(unary.call.outcome).toMatchObject({ response: { type: "inline", json: body } });

    const messages: MessageMeta[] = Array.from({ length: 300 }, (_, i) => ({
      dir: "in", index: i + 1, atMs: i, sizeBytes: 2, preview: "{}", json: "{}",
    }));
    const stream = buildRecord(start, { type: "stream", entry: entry({ messages }), elapsedMs: 1 });
    expect(stream.call.outcome).toMatchObject({ omitted_messages: 0 });
    expect(stream.call.outcome.type === "stream" && stream.call.outcome.messages.length).toBe(300);
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
    expect(huge.call.outcome.type === "stream" && huge.call.outcome.messages[0]).toEqual({
      direction: "out", index: 4_294_967_295, at_ms: 1.5, size_bytes: 4_294_967_295, preview: "", json: null,
    });
  });

  it("streamKindOf refuses unary", () => {
    expect(streamKindOf("client")).toBe("client");
    expect(() => streamKindOf("unary")).toThrow();
  });
});

describe("buildHttpRecord", () => {
  const draft = newHttpStep({
    template: {
      method: "PUT",
      url_template: "{{base}}/users/{{id}}",
      query: [{ key: "off", value: "1", enabled: false }],
      headers: [],
      body: { kind: "text", text: "hi {{name}}" },
      auth: { kind: "none" },
    },
  });

  it("records the template as authored with the response, timed by the response", () => {
    const response: HttpResponseIpc = {
      status: 204, reason: "No Content", headers: [{ name: "x-id", value: "7" }], body: { type: "empty" }, size_bytes: 0,
      elapsed_ms: 15,
    };
    expect(
      buildHttpRecord({ id: "call-h", draft, startedAt: 5, origin: { collectionId: "c1", requestId: "h1" } }, { type: "response", response }),
    ).toEqual({
      id: "call-h",
      started_at_ms: 5,
      origin: { collection_id: "c1", request_id: "h1" },
      elapsed_ms: 15,
      call: {
        protocol: "http",
        request: {
          method: "PUT",
          url_template: "{{base}}/users/{{id}}",
          query: [{ key: "off", value: "1", enabled: false }],
          headers: [],
          body: { kind: "text", text: "hi {{name}}" },
          auth: { kind: "none" },
        },
        outcome: { type: "response", response },
      },
    });
  });

  it("records a fault with the parsed kind and clamps its elapsed time to u32", () => {
    const record = buildHttpRecord(
      { id: "call-h", draft, startedAt: 5, origin: null },
      { type: "fault", fault: { kind: "dns", message: "no such host" }, elapsedMs: 7.6 },
    );
    expect(record).toMatchObject({
      origin: null,
      elapsed_ms: 8,
      call: { protocol: "http", outcome: { type: "fault", fault: { kind: "dns", message: "no such host" } } },
    });
  });
});
