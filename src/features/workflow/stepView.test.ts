import { describe, it, expect } from "vitest";
import { newStep } from "./model";
import { shortService, statusChip, summarizeStep } from "./stepView";
import { streamStore, type StreamEntry } from "@/features/stream/streamStore";
import type { InvokeOutcomeIpc, MethodKindIpc } from "@/ipc/bindings";

function outcome(code: number, ms = 12): InvokeOutcomeIpc {
  return {
    status_code: code,
    status_message: code === 0 ? "OK" : "ERR",
    response_json: "{}",
    trailing_metadata: {},
    status_details: [],
    elapsed_ms: ms,
  };
}

/** An ended / cancelled Stream store entry, as the store would leave it. */
function streamEntry(kind: MethodKindIpc, end: { code: number; elapsedMs: number } | "cancelled"): StreamEntry {
  streamStore.reset();
  streamStore.open("s1", kind, Date.now());
  if (end === "cancelled") streamStore.cancel("s1");
  else {
    streamStore.push("s1", {
      type: "End", status_code: end.code, status_message: "", status_details: [], trailing_metadata: {},
      elapsed_ms: end.elapsedMs, message_count: 3, total_bytes: 9,
    });
  }
  return streamStore.get("s1")!;
}

describe("shortService", () => {
  it("keeps only the last dotted segment", () => {
    expect(shortService("payments.v1.PaymentService")).toBe("PaymentService");
    expect(shortService("Health")).toBe("Health");
  });
});

describe("summarizeStep", () => {
  const base = { address: "h:443", tls: true, service: "p.v1.S", method: "Get" };

  it("uses a 1-based number and a short title", () => {
    const s = summarizeStep(newStep(base), 0);
    expect(s.number).toBe(1);
    expect(s.title).toBe("S · Get");
  });

  it("reports a pending draft", () => {
    const s = summarizeStep(newStep(base), 2);
    expect(s.number).toBe(3);
    expect(s.tone).toBe("pending");
    expect(s.statusText).toBe("draft");
    expect(s.elapsedMs).toBeNull();
  });

  it("reports a sending step", () => {
    const step = { ...newStep(base), status: "sending" as const };
    const s = summarizeStep(step, 0);
    expect(s.tone).toBe("pending");
    expect(s.statusText).toBe("…");
  });

  it("reports an OK outcome with code and elapsed", () => {
    const step = { ...newStep(base), status: "ok" as const, outcome: outcome(0, 53) };
    const s = summarizeStep(step, 0);
    expect(s.tone).toBe("ok");
    expect(s.statusText).toBe("✓ 0");
    expect(s.elapsedMs).toBe(53);
  });

  it("reports a non-OK gRPC outcome as error with its code", () => {
    const step = { ...newStep(base), status: "error" as const, outcome: outcome(5, 7) };
    const s = summarizeStep(step, 0);
    expect(s.tone).toBe("error");
    expect(s.statusText).toBe("✕ 5");
    expect(s.elapsedMs).toBe(7);
  });

  it("reports a cancelled stream call as a pending-toned terminal state", () => {
    const step = { ...newStep(base), status: "cancelled" as const, streamId: "s1" };
    const s = summarizeStep(step, 0);
    expect(s.tone).toBe("pending");
    expect(s.statusText).toBe("cancelled");
    expect(s.elapsedMs).toBeNull();
  });

  it("reports a client-side error (no outcome)", () => {
    const step = { ...newStep(base), status: "error" as const, error: { kind: "other" as const, message: "refused" } };
    const s = summarizeStep(step, 0);
    expect(s.tone).toBe("error");
    expect(s.statusText).toBe("✕ error");
    expect(s.elapsedMs).toBeNull();
  });
});

describe("summarizeStep — stream snapshots read the entry's End / Cancel, not the unary outcome", () => {
  const base = { address: "h:443", tls: true, service: "p.v1.S", method: "Watch" };
  const snapshot = (status: "ok" | "error" | "cancelled") => ({ ...newStep(base), status, streamId: "s1" });

  it("End OK → ✓ 0 with the stream's elapsed and the kind for the badge (never 'draft')", () => {
    const s = summarizeStep(snapshot("ok"), 0, streamEntry("server", { code: 0, elapsedMs: 40 }));
    expect(s.tone).toBe("ok");
    expect(s.statusText).toBe("✓ 0");
    expect(s.elapsedMs).toBeGreaterThanOrEqual(0);
    expect(s.kind).toBe("server");
  });

  it("End non-OK → ✕ <code>", () => {
    const s = summarizeStep(snapshot("error"), 0, streamEntry("client", { code: 5, elapsedMs: 7 }));
    expect(s.tone).toBe("error");
    expect(s.statusText).toBe("✕ 5");
    expect(s.kind).toBe("client");
  });

  it("Cancelled → cancelled, pending tone, kind kept", () => {
    const s = summarizeStep(snapshot("cancelled"), 0, streamEntry("bidi", "cancelled"));
    expect(s.tone).toBe("pending");
    expect(s.statusText).toBe("cancelled");
    expect(s.kind).toBe("bidi");
  });

  it("a released entry falls back on the step status — still not 'draft', no kind", () => {
    const ok = summarizeStep(snapshot("ok"), 0, null);
    expect(ok.statusText).toBe("✓ 0");
    expect(ok.kind).toBeNull();
    const err = summarizeStep(snapshot("error"), 0, null);
    expect(err.statusText).toBe("✕ error");
  });

  it("a unary step has no kind for the row badge", () => {
    expect(summarizeStep({ ...newStep(base), status: "ok" as const, outcome: outcome(0) }, 0).kind).toBeNull();
  });
});

describe("statusChip — history header chip, the footer's vocabulary", () => {
  const base = { address: "h:443", tls: true, service: "p.v1.S", method: "Watch" };
  const snapshot = (status: "ok" | "error" | "cancelled" | "sending" | "draft") => ({ ...newStep(base), status, streamId: "s1" });

  it("unary OK → ✓ OK · <elapsed>; unary non-OK → ✕ <code> <NAME>; client error → ✕ error", () => {
    expect(statusChip({ ...newStep(base), status: "ok", outcome: outcome(0, 12) }, null)).toEqual({ tone: "ok", text: "✓ OK · 12ms" });
    expect(statusChip({ ...newStep(base), status: "error", outcome: outcome(5) }, null)).toEqual({ tone: "error", text: "✕ 5 NOT_FOUND" });
    expect(statusChip({ ...newStep(base), status: "error", error: { kind: "other", message: "x" } }, null)).toEqual({ tone: "error", text: "✕ error" });
  });

  it("stream End OK → ✓ OK · <elapsed>", () => {
    const chip = statusChip(snapshot("ok"), streamEntry("server", { code: 0, elapsedMs: 1500 }));
    expect(chip?.tone).toBe("ok");
    expect(chip?.text).toMatch(/^✓ OK · \d/);
  });

  it("stream End non-OK → ✕ <code> <NAME>", () => {
    expect(statusChip(snapshot("error"), streamEntry("server", { code: 14, elapsedMs: 3 }))).toEqual({ tone: "error", text: "✕ 14 UNAVAILABLE" });
  });

  it("stream Cancelled → ○ Cancelled", () => {
    expect(statusChip(snapshot("cancelled"), streamEntry("client", "cancelled"))).toEqual({ tone: "pending", text: "○ Cancelled" });
  });

  it("no chip while sending or for a draft", () => {
    expect(statusChip(snapshot("sending"), null)).toBeNull();
    expect(statusChip(newStep(base), null)).toBeNull();
  });
});
