import { describe, it, expect } from "vitest";
import type { CollectionIpc, ItemIpc, SavedRequestIpc } from "@/ipc/bindings";
import { countRequests, allContainerIds, expandedIds, pathToItem, flattenVisible, pathNamesToItem, findSavedRequest } from "./treeNav";

function req(id: string, name = id): Extract<ItemIpc, { type: "request" }> {
  return {
    type: "request", id, name, address_template: "h:443", service: "p.v1.S", method: "M",
    body_template: "{}", metadata: [], auth: { kind: "none" }, tls_override: null,
    last_used_at: null, use_count: 0,
  };
}
function folder(id: string, items: ItemIpc[]): Extract<ItemIpc, { type: "folder" }> {
  return { type: "folder", id, name: id, items, expanded: false };
}
function col(id: string, items: ItemIpc[]): CollectionIpc {
  return {
    id, name: id, items, variables: {}, auth: { kind: "none" }, default_tls: false,
    skip_tls_verify: false, pinned: false, description: null, created_at: 0, expanded: false,
  };
}

const tree: CollectionIpc[] = [
  col("c1", [req("r1"), folder("f1", [req("r2"), folder("f2", [req("r3")])])]),
  col("c2", [req("r4")]),
];

describe("countRequests", () => {
  it("counts request leaves recursively", () => {
    expect(countRequests(tree[0])).toBe(3);
    expect(countRequests(tree[1])).toBe(1);
    expect(countRequests(req("x"))).toBe(1);
    expect(countRequests(folder("f", []))).toBe(0);
  });
});

describe("allContainerIds", () => {
  it("collects every collection and folder id (not requests)", () => {
    expect(allContainerIds(tree).sort()).toEqual(["c1", "c2", "f1", "f2"]);
  });
});

describe("expandedIds", () => {
  function efolder(id: string, items: ItemIpc[], expanded: boolean): Extract<ItemIpc, { type: "folder" }> {
    return { type: "folder", id, name: id, items, expanded };
  }
  function ecol(id: string, items: ItemIpc[], expanded: boolean): CollectionIpc {
    return {
      id, name: id, items, variables: {}, auth: { kind: "none" }, default_tls: false,
      skip_tls_verify: false, pinned: false, description: null, created_at: 0, expanded,
    };
  }

  it("returns exactly the container ids whose expanded flag is true (recursive)", () => {
    const t: CollectionIpc[] = [
      ecol("c1", [
        req("r1"),
        efolder("f1", [req("r2"), efolder("f2", [req("r3")], true)], true),
        efolder("f3", [], false),
      ], true),
      ecol("c2", [req("r4")], false),
    ];
    expect(expandedIds(t).sort()).toEqual(["c1", "f1", "f2"]);
  });

  it("returns an empty array when nothing is expanded", () => {
    expect(expandedIds(tree)).toEqual([]);
  });
});

describe("pathToItem", () => {
  it("returns [collectionId] for a top-level request", () => {
    expect(pathToItem(tree, "r1")).toEqual(["c1"]);
  });
  it("returns ancestor containers for a nested request", () => {
    expect(pathToItem(tree, "r3")).toEqual(["c1", "f1", "f2"]);
  });
  it("returns [collectionId] for the collection itself", () => {
    expect(pathToItem(tree, "c2")).toEqual(["c2"]);
  });
  it("returns null for unknown id or null", () => {
    expect(pathToItem(tree, "nope")).toBeNull();
    expect(pathToItem(tree, null)).toBeNull();
  });
});

describe("pathNamesToItem", () => {
  it("returns [collectionName] for a collection root", () => {
    expect(pathNamesToItem(tree, "c1")).toEqual(["c1"]);
  });

  it("returns [collection, request] for a top-level request", () => {
    expect(pathNamesToItem(tree, "r1")).toEqual(["c1", "r1"]);
  });

  it("returns the full nested path including the request itself", () => {
    expect(pathNamesToItem(tree, "r3")).toEqual(["c1", "f1", "f2", "r3"]);
  });

  it("returns the path to a folder including the folder itself", () => {
    expect(pathNamesToItem(tree, "f2")).toEqual(["c1", "f1", "f2"]);
  });

  it("returns null for an unknown id", () => {
    expect(pathNamesToItem(tree, "nope")).toBeNull();
  });

  it("returns null for a null id", () => {
    expect(pathNamesToItem(tree, null)).toBeNull();
  });
});

describe("findSavedRequest", () => {
  it("finds a top-level request in the named collection", () => {
    expect(findSavedRequest(tree, "c1", "r1")?.id).toBe("r1");
    expect(findSavedRequest(tree, "c2", "r4")?.id).toBe("r4");
  });
  it("finds a request nested in folders", () => {
    expect(findSavedRequest(tree, "c1", "r3")?.id).toBe("r3");
  });
  it("returns null when the collection is missing", () => {
    expect(findSavedRequest(tree, "nope", "r1")).toBeNull();
  });
  it("returns null when the item is missing in that collection", () => {
    expect(findSavedRequest(tree, "c1", "r4")).toBeNull();
    expect(findSavedRequest(tree, "c1", "f1")).toBeNull(); // folder is not a request
  });
});

describe("flattenVisible", () => {
  it("lists only collections when nothing is expanded", () => {
    const v = flattenVisible(tree, new Set());
    expect(v.map((n) => n.id)).toEqual(["c1", "c2"]);
    expect(v[0]).toMatchObject({ kind: "collection", depth: 0 });
  });
  it("expands children pre-order when containers are open", () => {
    const v = flattenVisible(tree, new Set(["c1", "f1"]));
    expect(v.map((n) => n.id)).toEqual(["c1", "r1", "f1", "r2", "f2", "c2"]);
    const r2 = v.find((n) => n.id === "r2") as Extract<typeof v[number], { kind: "request" }>;
    expect(r2.kind).toBe("request");
    expect(r2.depth).toBe(2);
    expect((r2.req as SavedRequestIpc).id).toBe("r2");
  });
});
