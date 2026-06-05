import { describe, it, expect } from "vitest";
import type { CollectionIpc, ItemIpc, SavedRequestIpc } from "@/ipc/bindings";
import {
  renameItemInTree, removeItemFromTree, insertItemInTree,
  renameCollectionInTree, setCollectionPinned, removeCollectionFromTree,
  replaceItemInTree, moveItemWithinTree, moveItemAcrossTree,
} from "./treeEdit";

function req(id: string, name = id): Extract<ItemIpc, { type: "request" }> {
  return {
    type: "request", id, name, address_template: "h:443", service: "p.v1.S", method: "M",
    body_template: "{}", metadata: [], auth: { kind: "none" }, tls_override: null,
    last_used_at: null, use_count: 0,
  };
}
const reqItem = req; // alias: move-helper tests use reqItem (same shape as req)
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

describe("replaceItemInTree", () => {
  it("swaps content fields but preserves id, name, and usage", () => {
    const tree = [col("c1", [folder("f1", [req("r2", "Original")])])];
    // give the original some usage to prove it is preserved
    const f1 = tree[0].items[0] as Extract<ItemIpc, { type: "folder" }>;
    (f1.items[0] as Extract<ItemIpc, { type: "request" }>).use_count = 7;
    (f1.items[0] as Extract<ItemIpc, { type: "request" }>).last_used_at = 123;

    const content: SavedRequestIpc = {
      id: "ignored", name: "ignored", address_template: "new:443", service: "p.v2.S",
      method: "NewM", body_template: '{"b":2}',
      metadata: [{ key: "k", value: "v", enabled: false }],
      auth: { kind: "env_var", env_var: "T", header_name: "authorization", prefix: "Bearer " },
      tls_override: true, last_used_at: null, use_count: 0,
    };
    const after = replaceItemInTree(tree, "c1", "r2", content);
    const target = (after[0].items[0] as Extract<ItemIpc, { type: "folder" }>).items[0] as Extract<
      ItemIpc, { type: "request" }
    >;
    expect(target.id).toBe("r2"); // preserved
    expect(target.name).toBe("Original"); // preserved
    expect(target.use_count).toBe(7); // preserved
    expect(target.last_used_at).toBe(123); // preserved
    expect(target.address_template).toBe("new:443"); // swapped
    expect(target.service).toBe("p.v2.S");
    expect(target.method).toBe("NewM");
    expect(target.body_template).toBe('{"b":2}');
    expect(target.metadata).toEqual([{ key: "k", value: "v", enabled: false }]);
    expect(target.tls_override).toBe(true);
    expect(target.type).toBe("request");
  });
});

describe("moveItemWithinTree", () => {
  // c1: [ f1{ r2 }, r3, r4 ]
  const base = (): CollectionIpc[] => [
    {
      id: "c1", name: "c1", variables: {}, auth: { kind: "none" }, default_tls: false,
      skip_tls_verify: false, pinned: false, description: null, created_at: 0,
      items: [
        { type: "folder", id: "f1", name: "f1", items: [reqItem("r2")] },
        reqItem("r3"),
        reqItem("r4"),
      ],
    },
  ];

  it("reorders within the root container (remove then insert at position)", () => {
    const after = moveItemWithinTree(base(), "c1", "r3", null, 2);
    expect(after[0].items.map((i) => i.id)).toEqual(["f1", "r4", "r3"]);
  });

  it("moves an item into a folder", () => {
    const after = moveItemWithinTree(base(), "c1", "r3", "f1", 1);
    const f1 = after[0].items.find((i) => i.id === "f1") as Extract<ItemIpc, { type: "folder" }>;
    expect(f1.items.map((i) => i.id)).toEqual(["r2", "r3"]);
    expect(after[0].items.map((i) => i.id)).toEqual(["f1", "r4"]);
  });

  it("is a no-op when the item id is absent", () => {
    const after = moveItemWithinTree(base(), "c1", "nope", null, 0);
    expect(after[0].items.map((i) => i.id)).toEqual(["f1", "r3", "r4"]);
  });
});

describe("moveItemAcrossTree", () => {
  const base = (): CollectionIpc[] => [
    {
      id: "c1", name: "c1", variables: {}, auth: { kind: "none" }, default_tls: false,
      skip_tls_verify: false, pinned: false, description: null, created_at: 0,
      items: [reqItem("r2")],
    },
    {
      id: "c2", name: "c2", variables: {}, auth: { kind: "none" }, default_tls: false,
      skip_tls_verify: false, pinned: false, description: null, created_at: 0,
      items: [{ type: "folder", id: "f5", name: "f5", items: [] }],
    },
  ];

  it("detaches from source and inserts into target", () => {
    const after = moveItemAcrossTree(base(), "c1", "r2", "c2", "f5", 0);
    expect(after[0].items).toEqual([]);
    const f5 = after[1].items.find((i) => i.id === "f5") as Extract<ItemIpc, { type: "folder" }>;
    expect(f5.items.map((i) => i.id)).toEqual(["r2"]);
  });

  it("is a no-op when the source item is absent", () => {
    const after = moveItemAcrossTree(base(), "c1", "nope", "c2", null, 0);
    expect(after[0].items.map((i) => i.id)).toEqual(["r2"]);
    expect(after[1].items.map((i) => i.id)).toEqual(["f5"]);
  });
});
