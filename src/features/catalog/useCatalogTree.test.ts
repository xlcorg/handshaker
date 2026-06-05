import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

vi.mock("@/ipc/client", () => ({
  ipc: {
    collectionList: vi.fn(),
    collectionGet: vi.fn(),
    collectionUpsert: vi.fn(),
    collectionDelete: vi.fn(),
    collectionAddItem: vi.fn(),
    collectionRenameItem: vi.fn(),
    collectionDeleteItem: vi.fn(),
    collectionDuplicateItem: vi.fn(),
  },
}));

import { ipc } from "@/ipc/client";
import type { CollectionIpc } from "@/ipc/bindings";
import { useCatalogTree } from "./useCatalogTree";

function col(id: string, name = id): CollectionIpc {
  return {
    id, name, items: [], variables: {}, auth: { kind: "none" }, default_tls: false,
    skip_tls_verify: false, pinned: false, description: null, created_at: 0,
  };
}

beforeEach(() => vi.clearAllMocks());

describe("useCatalogTree.reload", () => {
  it("loads each listed collection", async () => {
    vi.mocked(ipc.collectionList).mockResolvedValue([{ id: "c1", name: "c1" }]);
    vi.mocked(ipc.collectionGet).mockResolvedValue(col("c1"));
    const { result } = renderHook(() => useCatalogTree());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.tree.map((c) => c.id)).toEqual(["c1"]);
  });

  it("auto-creates 'My Collection' on first run (empty list)", async () => {
    vi.mocked(ipc.collectionList).mockResolvedValue([]);
    vi.mocked(ipc.collectionUpsert).mockResolvedValue(undefined);
    const { result } = renderHook(() => useCatalogTree());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.tree).toHaveLength(1);
    expect(result.current.tree[0].name).toBe("My Collection");
    expect(ipc.collectionUpsert).toHaveBeenCalledTimes(1);
  });
});

describe("optimistic mutations + rollback", () => {
  async function loaded() {
    vi.mocked(ipc.collectionList).mockResolvedValue([{ id: "c1", name: "c1" }]);
    vi.mocked(ipc.collectionGet).mockResolvedValue({
      ...col("c1"),
      items: [{
        type: "request", id: "r1", name: "r1", address_template: "h", service: "s",
        method: "m", body_template: "{}", metadata: [], auth: { kind: "none" },
        tls_override: null, last_used_at: null, use_count: 0,
      }],
    });
    const hook = renderHook(() => useCatalogTree());
    await waitFor(() => expect(hook.result.current.loading).toBe(false));
    return hook;
  }

  it("renameItem applies immediately and persists", async () => {
    const { result } = await loaded();
    vi.mocked(ipc.collectionRenameItem).mockResolvedValue(undefined);
    await act(async () => { await result.current.renameItem("c1", "r1", "Renamed"); });
    expect(result.current.tree[0].items[0].name).toBe("Renamed");
    expect(ipc.collectionRenameItem).toHaveBeenCalledWith("c1", "r1", "Renamed");
  });

  it("rolls back when the IPC call rejects", async () => {
    const { result } = await loaded();
    vi.mocked(ipc.collectionRenameItem).mockRejectedValue({ message: "boom" });
    await act(async () => {
      await expect(result.current.renameItem("c1", "r1", "Renamed")).rejects.toBeTruthy();
    });
    expect(result.current.tree[0].items[0].name).toBe("r1"); // reverted
    expect(result.current.error).toBe("boom");
  });

  it("setPinned upserts the patched collection", async () => {
    const { result } = await loaded();
    vi.mocked(ipc.collectionUpsert).mockResolvedValue(undefined);
    await act(async () => { await result.current.setPinned("c1", true); });
    expect(result.current.tree[0].pinned).toBe(true);
    expect(ipc.collectionUpsert).toHaveBeenCalledWith(expect.objectContaining({ id: "c1", pinned: true }));
  });

  it("duplicateItem reloads the affected collection from the backend", async () => {
    const { result } = await loaded();
    vi.mocked(ipc.collectionDuplicateItem).mockResolvedValue("r1-copy");
    vi.mocked(ipc.collectionGet).mockResolvedValue({ ...col("c1"), name: "c1-reloaded" });
    await act(async () => { await result.current.duplicateItem("c1", "r1"); });
    expect(ipc.collectionDuplicateItem).toHaveBeenCalledWith("c1", "r1");
    expect(result.current.tree[0].name).toBe("c1-reloaded");
  });

  it("updateItemContent replaces content optimistically and upserts the collection", async () => {
    const { result } = await loaded();
    vi.mocked(ipc.collectionUpsert).mockResolvedValue(undefined);
    const content = {
      id: "r1", name: "ignored", address_template: "new:443", service: "p.v2.S", method: "NewM",
      body_template: '{"b":2}', metadata: [], auth: { kind: "none" as const },
      tls_override: null, last_used_at: null, use_count: 0,
    };
    await act(async () => { await result.current.updateItemContent("c1", "r1", content); });
    const item = result.current.tree[0].items[0] as Extract<typeof content & { type: "request" }, { type: "request" }>;
    expect(item.method).toBe("NewM");
    expect(item.name).toBe("r1"); // preserved from the original
    expect(ipc.collectionUpsert).toHaveBeenCalledWith(
      expect.objectContaining({ id: "c1" }),
    );
  });

  it("updateItemContent rolls back when the upsert rejects", async () => {
    const { result } = await loaded();
    vi.mocked(ipc.collectionUpsert).mockRejectedValue({ message: "disk full" });
    const content = {
      id: "r1", name: "x", address_template: "new", service: "S", method: "NewM",
      body_template: "{}", metadata: [], auth: { kind: "none" as const },
      tls_override: null, last_used_at: null, use_count: 0,
    };
    await act(async () => {
      await expect(result.current.updateItemContent("c1", "r1", content)).rejects.toBeTruthy();
    });
    const item = result.current.tree[0].items[0] as Extract<{ type: "request"; method: string }, { type: "request" }>;
    expect(item.method).toBe("m"); // reverted to the seeded value
    expect(result.current.error).toBe("disk full");
  });
});
