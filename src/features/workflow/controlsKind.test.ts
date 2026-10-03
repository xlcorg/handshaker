import { describe, expect, it } from "vitest";
import { controlsKind, executedKind } from "./controlsKind";
import { newStep } from "./model";
import { streamStore } from "@/features/stream/streamStore";
import type { InvokeOutcomeIpc } from "@/ipc/bindings";

const outcome: InvokeOutcomeIpc = {
  status_code: 0, status_message: "", response_json: "{}", trailing_metadata: {}, status_details: [], elapsed_ms: 1,
};

describe("controlsKind — live → catalog → executed → null", () => {
  it("while a call is live, the kind it was opened with wins over a changed catalog", () => {
    expect(controlsKind({ liveKind: "client", catalogKind: "server", executedKind: "unary" })).toBe("client");
    expect(controlsKind({ liveKind: "server", catalogKind: null, executedKind: null })).toBe("server");
  });

  it("after the call ends the catalog kind wins again", () => {
    expect(controlsKind({ liveKind: null, catalogKind: "server", executedKind: "client" })).toBe("server");
    expect(controlsKind({ liveKind: null, catalogKind: "unary", executedKind: "bidi" })).toBe("unary");
  });

  it("with no catalog, the kind of the step's last executed call", () => {
    expect(controlsKind({ liveKind: null, catalogKind: null, executedKind: "client" })).toBe("client");
    expect(controlsKind({ liveKind: null, catalogKind: null, executedKind: "unary" })).toBe("unary");
  });

  it("nothing known → null (no badge, unary controls)", () => {
    expect(controlsKind({ liveKind: null, catalogKind: null, executedKind: null })).toBeNull();
  });
});

describe("executedKind — the kind of the step's last executed call", () => {
  const base = { address: "h", service: "S", method: "M" };

  it("a stream step reads the kind kept on its Stream store entry (core's Opened.kind)", () => {
    streamStore.reset();
    streamStore.open("s1", "client");
    const step = { ...newStep(base), streamId: "s1", status: "ok" as const };
    expect(executedKind(step, streamStore.get(step.streamId))).toBe("client");
  });

  it("a stream step whose entry was released is unknown — never resurrected", () => {
    streamStore.reset();
    const step = { ...newStep(base), streamId: "gone", status: "ok" as const };
    expect(streamStore.get(step.streamId)).toBeNull();
    expect(executedKind(step, streamStore.get(step.streamId))).toBeNull();
  });

  it("a step with no streamId but a unary outcome ran as unary", () => {
    const step = { ...newStep(base), status: "ok" as const, outcome };
    expect(executedKind(step, null)).toBe("unary");
  });

  it("a step that never executed has no executed kind", () => {
    expect(executedKind(newStep(base), null)).toBeNull();
  });
});
