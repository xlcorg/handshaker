import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./bindings", () => ({
  commands: { collectionSetNodeAuth: vi.fn() },
}));

import { commands } from "./bindings";
import { collectionSetNodeAuth } from "./client";

beforeEach(() => vi.clearAllMocks());

describe("collectionSetNodeAuth wrapper", () => {
  it("calls the command and resolves on ok", async () => {
    vi.mocked(commands.collectionSetNodeAuth).mockResolvedValue({ status: "ok", data: null } as never);
    await collectionSetNodeAuth("c1", null, { kind: "none" });
    expect(commands.collectionSetNodeAuth).toHaveBeenCalledWith("c1", null, { kind: "none" });
  });

  it("throws the error payload on an error result", async () => {
    vi.mocked(commands.collectionSetNodeAuth).mockResolvedValue({
      status: "error",
      error: { message: "nope" },
    } as never);
    await expect(collectionSetNodeAuth("c1", null, { kind: "none" })).rejects.toEqual({ message: "nope" });
  });
});
