import { describe, it, expect } from "vitest";
import type { CollectionIpc, ItemIpc } from "@/ipc/bindings";
import { draftBreadcrumb } from "./draftHeader";
import { newStep } from "./model";

const draft = newStep({
  address: "h:443", tls: false, service: "pkg.v1.NotesService", method: "Create",
});

function req(id: string, name: string): Extract<ItemIpc, { type: "request" }> {
  return {
    type: "request", id, name, address_template: "h:443", service: "p.v1.S", method: "M",
    body_template: "{}", metadata: [], auth: { kind: "none" }, tls_override: null,
    last_used_at: null, use_count: 0,
  };
}
function folder(id: string, name: string, items: ItemIpc[]): Extract<ItemIpc, { type: "folder" }> {
  return { type: "folder", id, name, items };
}
function col(id: string, name: string, items: ItemIpc[]): CollectionIpc {
  return {
    id, name, items, variables: {}, auth: { kind: "none" }, default_tls: false,
    skip_tls_verify: false, pinned: false, description: null, created_at: 0,
  };
}

const tree: CollectionIpc[] = [
  col("c1", "Notes", [folder("f1", "Staging", [req("r1", "Create")])]),
];

describe("draftBreadcrumb", () => {
  it("returns the unbound label for a draft with no origin", () => {
    expect(draftBreadcrumb(draft, null)).toEqual(["Новый реквест"]);
  });

  it("returns the full live path (collection › folders › request) from the catalog", () => {
    const origin = { collectionId: "c1", requestId: "r1", collectionName: "Notes", requestName: "Create" };
    expect(draftBreadcrumb(draft, origin, tree)).toEqual(["Notes", "Staging", "Create"]);
  });

  it("falls back to stored origin names when the request is not yet in the catalog", () => {
    const origin = { collectionId: "cX", requestId: "rX", collectionName: "Notes", requestName: "Create" };
    expect(draftBreadcrumb(draft, origin, tree)).toEqual(["Notes", "Create"]);
  });

  it("falls back to the request name alone when collection name is missing", () => {
    expect(
      draftBreadcrumb(draft, { collectionId: "c1", requestId: "rX", requestName: "Create note" }, []),
    ).toEqual(["Create note"]);
  });

  it("falls back to service / method when origin has no names and catalog lacks the id", () => {
    expect(draftBreadcrumb(draft, { collectionId: "c1", requestId: "rX" }, [])).toEqual([
      "NotesService / Create",
    ]);
  });
});
