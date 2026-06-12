import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import type { ItemIpc } from "@/ipc/bindings";

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
    collectionSetExpanded: vi.fn(),
  },
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { ipc } from "@/ipc/client";
import { toast } from "sonner";
import type { CollectionIpc } from "@/ipc/bindings";
import { useCatalogTree } from "./useCatalogTree";

function col(id: string, name = id): CollectionIpc {
  return {
    id, name, items: [], variables: {}, auth: { kind: "none" }, default_tls: false,
    skip_tls_verify: false, pinned: false, description: null, created_at: 0, expanded: false,
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

  it("duplicateItem reloads the affected collection from the backend and returns the copied item", async () => {
    const { result } = await loaded();
    vi.mocked(ipc.collectionDuplicateItem).mockResolvedValue("r1-copy");
    vi.mocked(ipc.collectionGet).mockResolvedValue({
      ...col("c1"),
      name: "c1-reloaded",
      items: [
        {
          type: "request", id: "r1-copy", name: "r1 copy", address_template: "h", service: "s",
          method: "m", body_template: "{}", metadata: [], auth: { kind: "none" },
          tls_override: null, last_used_at: null, use_count: 0,
        },
      ],
    });
    let item: ItemIpc | null = null;
    await act(async () => { item = await result.current.duplicateItem("c1", "r1"); });
    expect(ipc.collectionDuplicateItem).toHaveBeenCalledWith("c1", "r1");
    expect(result.current.tree[0].name).toBe("c1-reloaded");
    expect(toast.success).not.toHaveBeenCalled();
    // duplicateItem returns the copied item from the reloaded collection
    expect(item).toMatchObject({ id: "r1-copy", type: "request" });
  });

  it("duplicateItem toasts the item name on failure", async () => {
    const { result } = await loaded();
    vi.mocked(ipc.collectionDuplicateItem).mockRejectedValue({ message: "boom" });
    await act(async () => {
      await expect(result.current.duplicateItem("c1", "r1")).rejects.toBeTruthy();
    });
    expect(toast.error).toHaveBeenCalledWith('Couldn\'t duplicate "r1"');
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
    expect(toast.success).toHaveBeenCalledWith('Renamed to "Renamed"');
  });

  it("emits an error toast and rolls back when the operation rejects", async () => {
    const { result } = await loaded();
    vi.mocked(ipc.collectionRenameItem).mockRejectedValue({ message: "boom" });
    await act(async () => {
      await expect(result.current.renameItem("c1", "r1", "Renamed")).rejects.toBeTruthy();
    });
    expect(result.current.tree[0].items[0].name).toBe("r1"); // reverted
    expect(toast.error).toHaveBeenCalledWith('Couldn\'t rename "r1"');
  });

  it("setPinned toasts Pinned on success", async () => {
    const { result } = await loaded();
    vi.mocked(ipc.collectionUpsert).mockResolvedValue(undefined);
    await act(async () => { await result.current.setPinned("c1", true); });
    expect(toast.success).toHaveBeenCalledWith('Pinned "c1"');
  });

  it("setPinned toasts Unpinned with the collection name", async () => {
    const { result } = await loaded();
    vi.mocked(ipc.collectionUpsert).mockResolvedValue(undefined);
    await act(async () => { await result.current.setPinned("c1", false); });
    expect(toast.success).toHaveBeenCalledWith('Unpinned "c1"');
  });

  it("createCollection toasts the name on failure", async () => {
    const { result } = await loaded();
    vi.mocked(ipc.collectionUpsert).mockRejectedValue({ message: "boom" });
    await act(async () => {
      await expect(result.current.createCollection("New Col")).rejects.toBeTruthy();
    });
    expect(toast.error).toHaveBeenCalledWith('Couldn\'t create "New Col"');
  });

  it("deleteCollection toasts the collection name on success and failure", async () => {
    const { result } = await loaded();
    vi.mocked(ipc.collectionDelete).mockResolvedValue(undefined);
    await act(async () => { await result.current.deleteCollection("c1"); });
    expect(toast.success).toHaveBeenCalledWith('Deleted "c1"');

    const { result: r2 } = await loaded();
    vi.mocked(ipc.collectionDelete).mockRejectedValue({ message: "boom" });
    await act(async () => {
      await expect(r2.current.deleteCollection("c1")).rejects.toBeTruthy();
    });
    expect(toast.error).toHaveBeenCalledWith('Couldn\'t delete "c1"');
  });

  it("renameCollection toasts the new name on success and the old name on failure", async () => {
    const { result } = await loaded();
    vi.mocked(ipc.collectionUpsert).mockResolvedValue(undefined);
    await act(async () => { await result.current.renameCollection("c1", "Renamed Col"); });
    expect(toast.success).toHaveBeenCalledWith('Renamed to "Renamed Col"');

    const { result: r2 } = await loaded();
    vi.mocked(ipc.collectionUpsert).mockRejectedValue({ message: "boom" });
    await act(async () => {
      await expect(r2.current.renameCollection("c1", "Renamed Col")).rejects.toBeTruthy();
    });
    expect(toast.error).toHaveBeenCalledWith('Couldn\'t rename "c1"');
  });

  it("addItem is silent on success (request and folder)", async () => {
    const { result } = await loaded();
    vi.mocked(ipc.collectionAddItem).mockResolvedValue(undefined);
    await act(async () => {
      await result.current.addItem("c1", null, {
        type: "request", id: "r9", name: "R", address_template: "h", service: "s",
        method: "m", body_template: "{}", metadata: [], auth: { kind: "none" },
        tls_override: null, last_used_at: null, use_count: 0,
      });
      await result.current.addItem("c1", null, { type: "folder", id: "f9", name: "F", items: [], expanded: false });
    });
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("deleteItem toasts the item kind", async () => {
    const { result } = await loaded();
    vi.mocked(ipc.collectionDeleteItem).mockResolvedValue(null);
    await act(async () => { await result.current.deleteItem("c1", "r1"); });
    expect(toast.success).toHaveBeenCalledWith('Deleted "r1"');
  });
});

describe("useCatalogTree setExpanded", () => {
  async function loadedWithFolder() {
    vi.mocked(ipc.collectionList).mockResolvedValue([{ id: "c1", name: "c1" }]);
    vi.mocked(ipc.collectionGet).mockResolvedValue({
      ...col("c1"),
      items: [{ type: "folder", id: "f1", name: "f1", items: [], expanded: false }],
    });
    const hook = renderHook(() => useCatalogTree());
    await waitFor(() => expect(hook.result.current.loading).toBe(false));
    return hook;
  }

  it("flips a folder's flag locally and calls collectionSetExpanded", async () => {
    const { result } = await loadedWithFolder();
    vi.mocked(ipc.collectionSetExpanded).mockResolvedValue(undefined);
    await act(async () => { await result.current.setExpanded("c1", "f1", true); });
    const f1 = result.current.tree[0].items[0] as Extract<typeof result.current.tree[0]["items"][number], { type: "folder" }>;
    expect(f1.expanded).toBe(true);
    expect(ipc.collectionSetExpanded).toHaveBeenCalledWith("c1", "f1", true);
  });

  it("flips the collection's flag with a null itemId", async () => {
    const { result } = await loadedWithFolder();
    vi.mocked(ipc.collectionSetExpanded).mockResolvedValue(undefined);
    await act(async () => { await result.current.setExpanded("c1", null, true); });
    expect(result.current.tree[0].expanded).toBe(true);
    expect(ipc.collectionSetExpanded).toHaveBeenCalledWith("c1", null, true);
  });

  it("rolls back when collectionSetExpanded rejects", async () => {
    const { result } = await loadedWithFolder();
    vi.mocked(ipc.collectionSetExpanded).mockRejectedValue({ message: "boom" });
    await act(async () => {
      await expect(result.current.setExpanded("c1", "f1", true)).rejects.toBeTruthy();
    });
    const f1 = result.current.tree[0].items[0] as Extract<typeof result.current.tree[0]["items"][number], { type: "folder" }>;
    expect(f1.expanded).toBe(false); // reverted
    expect(toast.error).toHaveBeenCalledWith("Couldn't save expansion");
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
      items: [{ type: "folder", id: "f1", name: "f1", items: [], expanded: false }, reqItem("r3")],
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
    expect(toast.success).toHaveBeenCalledWith('Moved "r3"');
  });

  it("moveItemAcross calls collectionMoveItemAcross and relocates locally", async () => {
    const { result } = await loadedTwo();
    vi.mocked(ipc.collectionMoveItemAcross).mockResolvedValue(undefined);
    await act(async () => {
      await result.current.moveItemAcross("c1", "r3", "c2", null, 0);
    });
    expect(ipc.collectionMoveItemAcross).toHaveBeenCalledWith("c1", "r3", "c2", null, 0);
    expect(result.current.tree.find((c) => c.id === "c2")!.items.map((i) => i.id)).toEqual(["r3"]);
    expect(toast.success).toHaveBeenCalledWith('Moved "r3"');
  });

  it("rolls back moveItem when the IPC rejects", async () => {
    const { result } = await loadedTwo();
    const before = JSON.stringify(result.current.tree);
    vi.mocked(ipc.collectionMoveItem).mockRejectedValueOnce({ message: "boom" });
    await act(async () => {
      await expect(result.current.moveItem("c1", "r3", "f1", 0)).rejects.toBeTruthy();
    });
    expect(JSON.stringify(result.current.tree)).toBe(before);
    expect(toast.error).toHaveBeenCalledWith('Couldn\'t move "r3"');
  });
});
