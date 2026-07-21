import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/ipc/client", () => ({
  ipc: {
    appSettingsGet: vi.fn(),
    appSettingsSet: vi.fn(),
  },
}));

import { ipc } from "@/ipc/client";
import { loadUiState, readUiState, patchUiState, resetUiState } from "./uiState";

beforeEach(() => {
  vi.clearAllMocks();
  resetUiState();
});

describe("uiState cache", () => {
  it("loadUiState reads from the backend and caches it", async () => {
    const value = { sort_key: "recent", active_request: null };
    vi.mocked(ipc.appSettingsGet).mockResolvedValue(value as never);
    await expect(loadUiState()).resolves.toBe(value);
    expect(ipc.appSettingsGet).toHaveBeenCalledTimes(1);
    expect(readUiState()).toBe(value);
  });

  it("patchUiState sends the FULL merged object and updates the cache", async () => {
    vi.mocked(ipc.appSettingsSet).mockResolvedValue(undefined as never);
    await patchUiState({ sort_key: "recent" });
    expect(ipc.appSettingsSet).toHaveBeenCalledWith({
      sort_key: "recent",
      active_request: null,
      links_placement: "strip",
    });
    expect(readUiState()).toEqual({
      sort_key: "recent",
      active_request: null,
      links_placement: "strip",
    });
  });

  it("subsequent patches do not clobber earlier fields", async () => {
    vi.mocked(ipc.appSettingsSet).mockResolvedValue(undefined as never);
    await patchUiState({ sort_key: "recent" });
    await patchUiState({ active_request: { collection_id: "c1", item_id: "r1" } });
    expect(ipc.appSettingsSet).toHaveBeenLastCalledWith({
      sort_key: "recent",
      active_request: { collection_id: "c1", item_id: "r1" },
      links_placement: "strip",
    });
    expect(readUiState()).toEqual({
      sort_key: "recent",
      active_request: { collection_id: "c1", item_id: "r1" },
      links_placement: "strip",
    });
  });
});
