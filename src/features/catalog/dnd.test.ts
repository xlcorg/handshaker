import { describe, it, expect } from "vitest";
import type { CollectionIpc, ItemIpc, SavedRequestIpc } from "@/ipc/bindings";
import { folderCount, isWithin, zoneFromPointer, planDrop, type DragData, type DropTarget } from "./dnd";

function req(id: string, name = id): ItemIpc {
  return {
    type: "request", id, name, address_template: "h:443", service: "p.v1.S", method: "M",
    body_template: "{}", metadata: [], auth: { kind: "none" }, tls_override: null,
    last_used_at: null, use_count: 0,
  } as SavedRequestIpc as ItemIpc;
}
function folder(id: string, items: ItemIpc[] = [], name = id): ItemIpc {
  return { type: "folder", id, name, items, expanded: false };
}
function col(id: string, items: ItemIpc[]): CollectionIpc {
  return {
    id, name: id, items, variables: {}, auth: { kind: "none" },
    default_tls: false, skip_tls_verify: false, pinned: false, description: null, created_at: 0,
    expanded: false,
  };
}

describe("folderCount", () => {
  it("counts folders in a container", () => {
    expect(folderCount([folder("f1"), folder("f2"), req("r1")])).toBe(2);
    expect(folderCount([req("r1")])).toBe(0);
  });
});

describe("isWithin", () => {
  const items = [folder("f1", [folder("f2", [req("r1")])])];
  it("is true for self, descendants; false otherwise", () => {
    expect(isWithin(items, "f1", "f1")).toBe(true);
    expect(isWithin(items, "f1", "f2")).toBe(true);
    expect(isWithin(items, "f1", "r1")).toBe(true);
    expect(isWithin(items, "f2", "f1")).toBe(false);
  });
});

describe("zoneFromPointer", () => {
  const rect = { top: 0, height: 100 };
  it("collection rows are always inside", () => {
    expect(zoneFromPointer(rect, 5, "collection")).toBe("inside");
  });
  it("request rows split 50/50", () => {
    expect(zoneFromPointer(rect, 10, "request")).toBe("before");
    expect(zoneFromPointer(rect, 90, "request")).toBe("after");
  });
  it("folder rows split into before / inside / after thirds", () => {
    expect(zoneFromPointer(rect, 10, "folder")).toBe("before");
    expect(zoneFromPointer(rect, 50, "folder")).toBe("inside");
    expect(zoneFromPointer(rect, 90, "folder")).toBe("after");
  });
});

describe("planDrop", () => {
  // c1: [ f1{ r2 }, r3, r4 ]   c2: [ f5 ]
  const tree = (): CollectionIpc[] => [
    col("c1", [folder("f1", [req("r2")]), req("r3"), req("r4")]),
    col("c2", [folder("f5")]),
  ];
  const dragReq = (id: string): DragData => ({ collectionId: "c1", itemId: id, kind: "request" });
  const dragFolder = (id: string): DragData => ({ collectionId: "c1", itemId: id, kind: "folder" });
  const tgt = (id: string, kind: DropTarget["kind"], collectionId = "c1"): DropTarget => ({ collectionId, id, kind });

  it("reorders a request after another request (same container, post-removal index)", () => {
    expect(planDrop(tree(), dragReq("r3"), tgt("r4", "request"), "after")).toEqual({
      sourceCollectionId: "c1", itemId: "r3", targetCollectionId: "c1", parentId: null, position: 2,
    });
  });

  it("clamps a request dropped before a folder to the top of the request block", () => {
    expect(planDrop(tree(), dragReq("r4"), tgt("f1", "folder"), "before")).toEqual({
      sourceCollectionId: "c1", itemId: "r4", targetCollectionId: "c1", parentId: null, position: 1,
    });
  });

  it("drops a request inside a folder (append at end)", () => {
    expect(planDrop(tree(), dragReq("r3"), tgt("f1", "folder"), "inside")).toEqual({
      sourceCollectionId: "c1", itemId: "r3", targetCollectionId: "c1", parentId: "f1", position: 1,
    });
  });

  it("drops a request onto a collection header (root, after the folder block)", () => {
    const drag: DragData = { collectionId: "c1", itemId: "r3", kind: "request" };
    expect(planDrop(tree(), drag, tgt("c2", "collection", "c2"), "inside")).toEqual({
      sourceCollectionId: "c1", itemId: "r3", targetCollectionId: "c2", parentId: null, position: 1,
    });
  });

  it("moves a request across collections before a sibling", () => {
    const drag: DragData = { collectionId: "c1", itemId: "r3", kind: "request" };
    expect(planDrop(tree(), drag, tgt("f5", "folder", "c2"), "before")).toEqual({
      sourceCollectionId: "c1", itemId: "r3", targetCollectionId: "c2", parentId: null, position: 1,
    });
  });

  it("rejects dropping a folder inside its own descendant", () => {
    expect(planDrop(tree(), dragFolder("f1"), tgt("f1", "folder"), "inside")).toBeNull();
  });

  it("rejects a no-op drop (request after the sibling it already follows region)", () => {
    expect(planDrop(tree(), dragReq("r3"), tgt("r4", "request"), "before")).toBeNull();
  });

  it("returns null when the dragged item or a collection is missing", () => {
    expect(planDrop(tree(), dragReq("nope"), tgt("r4", "request"), "before")).toBeNull();
    expect(planDrop(tree(), dragReq("r3"), tgt("x", "collection", "cX"), "inside")).toBeNull();
  });
});
