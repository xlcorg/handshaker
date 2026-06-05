import { describe, it, expect } from "vitest";
import { augmentTree } from "./savePicker";
import type { CollectionIpc } from "@/ipc/bindings";

function col(id: string, name: string, items: CollectionIpc["items"] = []): CollectionIpc {
  return {
    id, name, items, variables: {}, auth: { kind: "none" },
    default_tls: false, skip_tls_verify: false, pinned: false, description: null, created_at: 0,
  };
}

describe("augmentTree", () => {
  it("returns the tree unchanged when there is nothing pending", () => {
    const tree = [col("c1", "My APIs")];
    expect(augmentTree(tree, [], [])).toEqual(tree);
  });

  it("appends pending collections as empty collections", () => {
    const out = augmentTree([col("c1", "My APIs")], [{ tempId: "t1", name: "Sandbox" }], []);
    expect(out.map((c) => c.name)).toEqual(["My APIs", "Sandbox"]);
    expect(out[1]).toMatchObject({ id: "t1", name: "Sandbox", items: [] });
  });

  it("inserts a pending folder at the collection root", () => {
    const out = augmentTree(
      [col("c1", "My APIs")],
      [],
      [{ tempId: "f1", collectionId: "c1", parentId: null, name: "NotesApi" }],
    );
    expect(out[0].items).toEqual([{ type: "folder", id: "f1", name: "NotesApi", items: [] }]);
  });

  it("inserts a pending folder inside a pending collection", () => {
    const out = augmentTree(
      [],
      [{ tempId: "t1", name: "New" }],
      [{ tempId: "f1", collectionId: "t1", parentId: null, name: "NotesApi" }],
    );
    expect(out[0].items).toEqual([{ type: "folder", id: "f1", name: "NotesApi", items: [] }]);
  });

  it("nests a pending folder under an earlier pending folder", () => {
    const out = augmentTree(
      [col("c1", "My APIs")],
      [],
      [
        { tempId: "f1", collectionId: "c1", parentId: null, name: "Outer" },
        { tempId: "f2", collectionId: "c1", parentId: "f1", name: "Inner" },
      ],
    );
    const outer = out[0].items[0];
    expect(outer).toMatchObject({ id: "f1", name: "Outer" });
    if (outer.type !== "folder") throw new Error("expected outer to be a folder");
    expect(outer.items).toEqual([
      { type: "folder", id: "f2", name: "Inner", items: [] },
    ]);
  });
});
