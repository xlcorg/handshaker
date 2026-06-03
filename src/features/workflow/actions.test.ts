import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/ipc/client", () => ({
  grpcBuildRequestSkeleton: vi.fn(),
  grpcInvokeOneshot: vi.fn(),
}));

import * as ipc from "@/ipc/client";
import { createStepFromMethod, sendStep } from "./actions";

beforeEach(() => vi.clearAllMocks());

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
});
