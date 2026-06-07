import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./bindings", () => ({
  commands: {
    collectionSetExpanded: vi.fn(),
    appSettingsGet: vi.fn(),
    appSettingsSet: vi.fn(),
  },
}));

import { commands } from "./bindings";
import { collectionSetExpanded, appSettingsGet, appSettingsSet } from "./client";

beforeEach(() => vi.clearAllMocks());

describe("collectionSetExpanded wrapper", () => {
  it("forwards all args and resolves on ok", async () => {
    vi.mocked(commands.collectionSetExpanded).mockResolvedValue({ status: "ok", data: null } as never);
    await collectionSetExpanded("c1", null, true);
    expect(commands.collectionSetExpanded).toHaveBeenCalledWith("c1", null, true);
  });

  it("throws the error payload on an error result", async () => {
    const error = { message: "nope" };
    vi.mocked(commands.collectionSetExpanded).mockResolvedValue({ status: "error", error } as never);
    await expect(collectionSetExpanded("c1", "i1", false)).rejects.toBe(error);
  });
});

describe("appSettingsGet wrapper", () => {
  it("returns data on ok", async () => {
    const data = { sort_key: "name", active_request: null };
    vi.mocked(commands.appSettingsGet).mockResolvedValue({ status: "ok", data } as never);
    await expect(appSettingsGet()).resolves.toBe(data);
    expect(commands.appSettingsGet).toHaveBeenCalledWith();
  });

  it("throws the error payload on an error result", async () => {
    const error = { message: "boom" };
    vi.mocked(commands.appSettingsGet).mockResolvedValue({ status: "error", error } as never);
    await expect(appSettingsGet()).rejects.toBe(error);
  });
});

describe("appSettingsSet wrapper", () => {
  it("forwards the patch and resolves on ok", async () => {
    const patch = { sort_key: "recent", active_request: null };
    vi.mocked(commands.appSettingsSet).mockResolvedValue({ status: "ok", data: null } as never);
    await appSettingsSet(patch);
    expect(commands.appSettingsSet).toHaveBeenCalledWith(patch);
  });

  it("throws the error payload on an error result", async () => {
    const error = { message: "bad" };
    vi.mocked(commands.appSettingsSet).mockResolvedValue({ status: "error", error } as never);
    await expect(appSettingsSet({ sort_key: null, active_request: null })).rejects.toBe(error);
  });
});
