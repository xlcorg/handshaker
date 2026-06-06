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
    collectionMoveItem: vi.fn(),
    collectionMoveItemAcross: vi.fn(),
  },
}));

vi.mock("@/lib/toast", () => ({ toast: vi.fn() }));

import { ipc } from "@/ipc/client";
import { toast } from "@/lib/toast";
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
    expect(toast).toHaveBeenCalledWith("Реквест продублирован", "success");
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
  });

  it("emits a success toast when an operation with an ok label resolves", async () => {
    const { result } = await loaded();
    vi.mocked(ipc.collectionRenameItem).mockResolvedValue(undefined);
    await act(async () => { await result.current.renameItem("c1", "r1", "Renamed"); });
    expect(toast).toHaveBeenCalledWith("Реквест переименован", "success");
  });

  it("emits an error toast and rolls back when the operation rejects", async () => {
    const { result } = await loaded();
    vi.mocked(ipc.collectionRenameItem).mockRejectedValue({ message: "boom" });
    await act(async () => {
      await expect(result.current.renameItem("c1", "r1", "Renamed")).rejects.toBeTruthy();
    });
    expect(result.current.tree[0].items[0].name).toBe("r1"); // reverted
    expect(toast).toHaveBeenCalledWith("Не удалось переименовать реквест", "error");
  });

  it("emits no success toast for setPinned (ok label omitted)", async () => {
    const { result } = await loaded();
    vi.mocked(ipc.collectionUpsert).mockResolvedValue(undefined);
    await act(async () => { await result.current.setPinned("c1", true); });
    expect(toast).not.toHaveBeenCalledWith(expect.anything(), "success");
  });
});

describe("useCatalogTree move", () => {
  function reqItem(id: string) {
    return {
      type: "request", id, name: id, address_template: "h", service: "s", method: "m",
      body_template: "{}", metadata: [], auth: { kind: "none" }, tls_override: null,
      last_used_at: null, use_count: 0,
    } as const;
  }
  async function loadedTwo() {
    const c1 = {
      ...col("c1"),
      items: [{ type: "folder", id: "f1", name: "f1", items: [] }, reqItem("r3")],
    } as CollectionIpc;
    const c2 = col("c2");
    vi.mocked(ipc.collectionList).mockResolvedValue([
      { id: "c1", name: "c1" },
      { id: "c2", name: "c2" },
    ]);
    vi.mocked(ipc.collectionGet).mockImplementation(async (id: string) => (id === "c1" ? c1 : c2));
    const hook = renderHook(() => useCatalogTree());
    await waitFor(() => expect(hook.result.current.loading).toBe(false));
    return hook;
  }

  it("moveItem reshapes locally and calls collectionMoveItem", async () => {
    const { result } = await loadedTwo();
    vi.mocked(ipc.collectionMoveItem).mockResolvedValue(undefined);
    await act(async () => {
      await result.current.moveItem("c1", "r3", "f1", 0);
    });
    expect(ipc.collectionMoveItem).toHaveBeenCalledWith("c1", "r3", "f1", 0);
    const c1 = result.current.tree.find((c) => c.id === "c1")!;
    const f1 = c1.items.find((i) => i.id === "f1") as Extract<typeof c1.items[number], { type: "folder" }>;
    expect(f1.items.map((i) => i.id)).toEqual(["r3"]); // optimistic reshape
  });

  it("moveItemAcross calls collectionMoveItemAcross and relocates locally", async () => {
    const { result } = await loadedTwo();
    vi.mocked(ipc.collectionMoveItemAcross).mockResolvedValue(undefined);
    await act(async () => {
      await result.current.moveItemAcross("c1", "r3", "c2", null, 0);
    });
    expect(ipc.collectionMoveItemAcross).toHaveBeenCalledWith("c1", "r3", "c2", null, 0);
    expect(result.current.tree.find((c) => c.id === "c2")!.items.map((i) => i.id)).toEqual(["r3"]);
  });

  it("rolls back moveItem when the IPC rejects", async () => {
    const { result } = await loadedTwo();
    const before = JSON.stringify(result.current.tree);
    vi.mocked(ipc.collectionMoveItem).mockRejectedValueOnce({ message: "boom" });
    await act(async () => {
      await expect(result.current.moveItem("c1", "r3", "f1", 0)).rejects.toBeTruthy();
    });
    expect(JSON.stringify(result.current.tree)).toBe(before);
    expect(toast).toHaveBeenCalledWith("Не удалось переместить", "error");
  });
});
