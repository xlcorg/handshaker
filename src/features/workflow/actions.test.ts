import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/ipc/client", () => ({
  grpcBuildRequestSkeleton: vi.fn(),
  grpcInvokeOneshot: vi.fn(),
  varsResolve: vi.fn(),
}));

import * as ipc from "@/ipc/client";
import { createStepFromMethod, sendStep, stepPatchFromSendResult } from "./actions";

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(ipc.varsResolve).mockImplementation(async (tpl: string) => ({
    resolved: tpl,
    unresolved_vars: [],
    cycle_chain: null,
  }));
});

describe("createStepFromMethod", () => {
  it("builds a step with skeleton body from the contract", async () => {
    vi.mocked(ipc.grpcBuildRequestSkeleton).mockResolvedValue(
      '{\n  "order_id": ""\n}',
    );
    const step = await createStepFromMethod(
      { address: "order-api:443", tls: true },
      "order.v1.OrderService",
      "GetOrderState",
    );
    expect(ipc.grpcBuildRequestSkeleton).toHaveBeenCalledWith(
      { address: "order-api:443", tls: true, skip_verify: false },
      "order.v1.OrderService",
      "GetOrderState",
    );
    expect(step.requestJson).toContain("order_id");
    expect(step.status).toBe("draft");
    expect(step.service).toBe("order.v1.OrderService");
  });

  it("falls back to {} when skeleton fails", async () => {
    vi.mocked(ipc.grpcBuildRequestSkeleton).mockRejectedValue(new Error("boom"));
    const step = await createStepFromMethod(
      { address: "h:443", tls: true },
      "S",
      "M",
    );
    expect(step.requestJson).toBe("{}");
  });

  it("seeds metadata (deep copy) from service defaultMetadata and records serviceId", async () => {
    vi.mocked(ipc.grpcBuildRequestSkeleton).mockResolvedValue("{}");
    const defaults = [{ key: "x-tenant", value: "{{tenant}}", enabled: true }];
    const step = await createStepFromMethod(
      { address: "h:443", tls: true }, "S", "M",
      { serviceId: "svc-1", defaultMetadata: defaults },
    );
    expect(step.serviceId).toBe("svc-1");
    expect(step.metadata).toEqual(defaults);
    expect(step.metadata).not.toBe(defaults);       // deep copy: array identity differs
    expect(step.metadata[0]).not.toBe(defaults[0]); // and row identity differs
  });
});

describe("sendStep", () => {
  it("returns ok outcome on success", async () => {
    vi.mocked(ipc.grpcInvokeOneshot).mockResolvedValue({
      status_code: 0,
      status_message: "OK",
      response_json: '{"state":"OK"}',
      trailing_metadata: {},
      elapsed_ms: 12,
    });
    const res = await sendStep({
      address: "h:443",
      tls: true,
      service: "S",
      method: "M",
      requestJson: "{}",
      metadata: [{ key: "x", value: "1", enabled: true }],
    });
    expect(res.kind).toBe("ok");
    if (res.kind === "ok") expect(res.outcome.status_code).toBe(0);
    expect(ipc.grpcInvokeOneshot).toHaveBeenCalledWith(
      { address: "h:443", tls: true, skip_verify: false },
      { service: "S", method: "M", request_json: "{}", metadata: { x: "1" } },
    );
  });

  it("returns error kind with the IpcError message on client failure", async () => {
    vi.mocked(ipc.grpcInvokeOneshot).mockRejectedValue({ type: "Transport", message: "connection refused" });
    const res = await sendStep({
      address: "h:443",
      tls: true,
      service: "S",
      method: "M",
      requestJson: "{}",
      metadata: [],
    });
    expect(res.kind).toBe("error");
    if (res.kind === "error") expect(res.message).toContain("refused");
  });

  it("falls back to the IpcError type for messageless variants", async () => {
    vi.mocked(ipc.grpcInvokeOneshot).mockRejectedValue({ type: "NotConnected" });
    const res = await sendStep({
      address: "h:443",
      tls: true,
      service: "S",
      method: "M",
      requestJson: "{}",
      metadata: [],
    });
    expect(res.kind).toBe("error");
    if (res.kind === "error") expect(res.message).toBe("NotConnected");
  });

  it("omits disabled and empty-key metadata rows", async () => {
    vi.mocked(ipc.grpcInvokeOneshot).mockResolvedValue({
      status_code: 0,
      status_message: "OK",
      response_json: "{}",
      trailing_metadata: {},
      elapsed_ms: 1,
    });
    await sendStep({
      address: "h:443",
      tls: true,
      service: "S",
      method: "M",
      requestJson: "{}",
      metadata: [
        { key: "keep", value: "1", enabled: true },
        { key: "off", value: "2", enabled: false },
        { key: "", value: "3", enabled: true },
      ],
    });
    expect(ipc.grpcInvokeOneshot).toHaveBeenCalledWith(
      { address: "h:443", tls: true, skip_verify: false },
      { service: "S", method: "M", request_json: "{}", metadata: { keep: "1" } },
    );
  });

  it("sendStep returns an error result (does not throw) when varsResolve rejects", async () => {
    vi.mocked(ipc.varsResolve).mockRejectedValueOnce(new Error("backend boom"));
    const res = await sendStep({
      address: "{{host}}", tls: false, service: "S", method: "M",
      requestJson: "{}", metadata: [],
    });
    expect(res.kind).toBe("error");
    if (res.kind === "error") expect(res.message).toContain("backend boom");
    expect(ipc.grpcInvokeOneshot).not.toHaveBeenCalled();
  });

  it("sendStep blocks on unresolved variables and does not invoke", async () => {
    vi.mocked(ipc.varsResolve).mockImplementation(async (tpl: string) => {
      const m = [...tpl.matchAll(/\{\{([^{}]+)\}\}/g)].map((x) => x[1]);
      return { resolved: tpl, unresolved_vars: m, cycle_chain: null };
    });
    const res = await sendStep({
      address: "{{host}}", tls: false, service: "S", method: "M",
      requestJson: "{}", metadata: [],
    });
    expect(res.kind).toBe("unresolved");
    if (res.kind === "unresolved") expect(res.unresolved).toEqual(["host"]);
    expect(ipc.grpcInvokeOneshot).not.toHaveBeenCalled();
  });

  it("sendStep invokes with resolved address + metadata when all vars resolve", async () => {
    vi.mocked(ipc.varsResolve).mockImplementation(async (tpl: string) => ({
      resolved: tpl.replace("{{host}}", "api.internal"),
      unresolved_vars: [], cycle_chain: null,
    }));
    vi.mocked(ipc.grpcInvokeOneshot).mockResolvedValue({
      status_code: 0, status_message: "OK", response_json: "{}",
      trailing_metadata: {}, elapsed_ms: 5,
    });
    await sendStep({ address: "{{host}}", tls: true, service: "S", method: "M", requestJson: "{}", metadata: [] });
    expect(ipc.grpcInvokeOneshot).toHaveBeenCalledWith(
      { address: "api.internal", tls: true, skip_verify: false },
      expect.objectContaining({ service: "S", method: "M" }),
    );
  });
});

describe("stepPatchFromSendResult", () => {
  it("ok with status 0 → ok", () => {
    const outcome = { status_code: 0, status_message: "OK", response_json: "{}", trailing_metadata: {}, elapsed_ms: 1 };
    expect(stepPatchFromSendResult({ kind: "ok", outcome })).toEqual({ status: "ok", outcome, error: null });
  });
  it("ok with non-zero status → error (grpc status), keeps outcome", () => {
    const outcome = { status_code: 5, status_message: "NOT_FOUND", response_json: null, trailing_metadata: {}, elapsed_ms: 1 };
    expect(stepPatchFromSendResult({ kind: "ok", outcome })).toEqual({ status: "error", outcome, error: null });
  });
  it("unresolved → error with variable list", () => {
    const p = stepPatchFromSendResult({ kind: "unresolved", unresolved: ["host", "id"], cycle: null });
    expect(p.status).toBe("error");
    expect(p.outcome).toBeNull();
    expect(p.error).toBe("Unresolved variables: {{host}}, {{id}}");
  });
  it("unresolved with cycle → cycle message", () => {
    const p = stepPatchFromSendResult({ kind: "unresolved", unresolved: [], cycle: ["a", "b", "a"] });
    expect(p.error).toBe("Variable cycle: a → b → a");
  });
  it("error → error with message", () => {
    expect(stepPatchFromSendResult({ kind: "error", message: "boom" })).toEqual({ status: "error", outcome: null, error: "boom" });
  });
});
