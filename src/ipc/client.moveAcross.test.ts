import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./bindings", () => ({
  commands: { collectionMoveItemAcross: vi.fn() },
}));

import { commands } from "./bindings";
import { collectionMoveItemAcross } from "./client";

beforeEach(() => vi.clearAllMocks());

describe("collectionMoveItemAcross wrapper", () => {
  it("forwards all args and resolves on ok", async () => {
    vi.mocked(commands.collectionMoveItemAcross).mockResolvedValue({ status: "ok", data: null } as never);
    await collectionMoveItemAcross("src", "it", "dst", null, 2);
    expect(commands.collectionMoveItemAcross).toHaveBeenCalledWith("src", "it", "dst", null, 2);
  });

  it("throws the error payload on an error result", async () => {
    vi.mocked(commands.collectionMoveItemAcross).mockResolvedValue({
      status: "error",
      error: { message: "nope" },
    } as never);
    await expect(collectionMoveItemAcross("src", "it", "dst", "f1", 0)).rejects.toEqual({ message: "nope" });
  });
});
