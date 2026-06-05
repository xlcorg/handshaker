import { describe, it, expect } from "vitest";
import type { CollectionIpc, ItemIpc } from "@/ipc/bindings";
import {
  renameItemInTree, removeItemFromTree, insertItemInTree,
  renameCollectionInTree, setCollectionPinned, removeCollectionFromTree,
} from "./treeEdit";

function req(id: string, name = id): Extract<ItemIpc, { type: "request" }> {
  return {
    type: "request", id, name, address_template: "h:443", service: "p.v1.S", method: "M",
    body_template: "{}", metadata: [], auth: { kind: "none" }, tls_override: null,
    last_used_at: null, use_count: 0,
  };
}
function folder(id: string, items: ItemIpc[]): Extract<ItemIpc, { type: "folder" }> {
  return { type: "folder", id, name: id, items };
}
function col(id: string, items: ItemIpc[]): CollectionIpc {
  return {
    id, name: id, items, variables: {}, auth: { kind: "none" }, default_tls: false,
    skip_tls_verify: false, pinned: false, description: null, created_at: 0,
  };
}
const tree = (): CollectionIpc[] => [
  col("c1", [req("r1"), folder("f1", [req("r2")])]),
  col("c2", []),
];

describe("renameItemInTree", () => {
  it("renames a nested item without mutating the input", () => {
    const before = tree();
    const after = renameItemInTree(before, "c1", "r2", "Renamed");
    const f1 = after[0].items.find((i) => i.id === "f1") as Extract<ItemIpc, { type: "folder" }>;
    expect(f1.items[0].name).toBe("Renamed");
    // immutability: original untouched, collection identity preserved for non-target
    const f1Before = before[0].items.find((i) => i.id === "f1") as Extract<ItemIpc, { type: "folder" }>;
    expect(f1Before.items[0].name).toBe("r2");
    expect(after[1]).toBe(before[1]);
  });
});

describe("removeItemFromTree", () => {
  it("removes a top-level item", () => {
    const after = removeItemFromTree(tree(), "c1", "r1");
    expect(after[0].items.map((i) => i.id)).toEqual(["f1"]);
  });
  it("removes a nested item", () => {
    const after = removeItemFromTree(tree(), "c1", "r2");
    const f1 = after[0].items.find((i) => i.id === "f1") as Extract<ItemIpc, { type: "folder" }>;
    expect(f1.items).toEqual([]);
  });
});

describe("insertItemInTree", () => {
  it("appends at collection root when parentId is null", () => {
    const after = insertItemInTree(tree(), "c2", null, req("rX"));
    expect(after[1].items.map((i) => i.id)).toEqual(["rX"]);
  });
  it("appends inside a folder when parentId matches", () => {
    const after = insertItemInTree(tree(), "c1", "f1", req("rY"));
    const f1 = after[0].items.find((i) => i.id === "f1") as Extract<ItemIpc, { type: "folder" }>;
    expect(f1.items.map((i) => i.id)).toEqual(["r2", "rY"]);
  });
});

describe("collection transforms", () => {
  it("renames a collection", () => {
    expect(renameCollectionInTree(tree(), "c2", "C Two")[1].name).toBe("C Two");
  });
  it("sets pinned", () => {
    expect(setCollectionPinned(tree(), "c1", true)[0].pinned).toBe(true);
  });
  it("removes a collection", () => {
    expect(removeCollectionFromTree(tree(), "c1").map((c) => c.id)).toEqual(["c2"]);
  });
});
