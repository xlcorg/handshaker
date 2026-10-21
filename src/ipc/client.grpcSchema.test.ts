import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./bindings", () => ({
  commands: { grpcContractRead: vi.fn() },
}));

import { commands } from "./bindings";
import { grpcContractRead } from "./client";

beforeEach(() => vi.clearAllMocks());

describe("grpcContractRead wrapper", () => {
  it("forwards a request id and timeout so a cache-miss dial is bounded and cancelable", async () => {
    vi.mocked(commands.grpcContractRead).mockResolvedValue({
      status: "ok",
      data: {
        catalog: { services: [] },
        input_schema: null,
        output_schema: null,
        skeleton: "{}",
      },
    } as never);
    await grpcContractRead(
      "{{host}}:443",
      null,
      { collection_id: "c", env_name: "prod" },
      { service: "p.S", method: "M", refresh: false },
    );
    expect(commands.grpcContractRead).toHaveBeenCalledWith(
      "{{host}}:443",
      null,
      { collection_id: "c", env_name: "prod" },
      { service: "p.S", method: "M", refresh: false },
      expect.any(String),
      expect.any(Number),
    );
  });
});
