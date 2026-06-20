import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./bindings", () => ({
  commands: { grpcBuildRequestSkeleton: vi.fn(), grpcMessageSchema: vi.fn() },
}));

import { commands } from "./bindings";
import { grpcBuildRequestSkeleton, grpcMessageSchema } from "./client";

const target = { address: "h:443", tls: true, skip_verify: false };

beforeEach(() => vi.clearAllMocks());

describe("grpcBuildRequestSkeleton wrapper", () => {
  it("forwards a request id + timeout so a cache-miss dial is bounded and cancelable", async () => {
    vi.mocked(commands.grpcBuildRequestSkeleton).mockResolvedValue({ status: "ok", data: "{}" } as never);
    await grpcBuildRequestSkeleton(target, "p.S", "M");
    expect(commands.grpcBuildRequestSkeleton).toHaveBeenCalledWith(
      target,
      "p.S",
      "M",
      expect.any(String),
      expect.any(Number),
    );
  });
});

describe("grpcMessageSchema wrapper", () => {
  it("forwards a request id + timeout so a cache-miss dial is bounded and cancelable", async () => {
    vi.mocked(commands.grpcMessageSchema).mockResolvedValue({ status: "ok", data: {} } as never);
    await grpcMessageSchema(target, "p.S", "M", "input");
    expect(commands.grpcMessageSchema).toHaveBeenCalledWith(
      target,
      "p.S",
      "M",
      "input",
      expect.any(String),
      expect.any(Number),
    );
  });
});
