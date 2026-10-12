import { describe, it, expect } from "vitest";
import type { CollectionIpc, ItemIpc } from "@/ipc/bindings";
import { draftBreadcrumb } from "./draftHeader";
import { newStep } from "./model";
import { newHttpStep } from "@/features/http/model";
import { messages } from "@/lib/messages";

const draft = newStep({
  address: "h:443", tls: false, service: "pkg.v1.NotesService", method: "Create",
});

function req(id: string, name: string): Extract<ItemIpc, { type: "request" }> {
  return {
    type: "request",
    id,
    name,
    template: { protocol: "grpc", address_template: "h:443", service: "p.v1.S", method: "M", body_template: "{}", metadata: [], auth: { kind: "none" }, tls_override: null },
    last_used_at: null,
    use_count: 0,
  };
}
function folder(id: string, name: string, items: ItemIpc[]): Extract<ItemIpc, { type: "folder" }> {
  return { type: "folder", id, name, items, expanded: false };
}
function col(id: string, name: string, items: ItemIpc[]): CollectionIpc {
  return {
    id, name, items, variables: {}, auth: { kind: "none" }, default_tls: false,
    skip_tls_verify: false, pinned: false, description: null, created_at: 0, expanded: false,
  };
}

const tree: CollectionIpc[] = [
  col("c1", "Notes", [folder("f1", "Staging", [req("r1", "Create")])]),
];

describe("draftBreadcrumb", () => {
  it("returns the unbound label for a draft with no origin", () => {
    expect(draftBreadcrumb(draft, null)).toEqual([messages.workflow.draft.newRequest]);
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

  const httpDraft = newHttpStep({
    template: { method: "GET", url_template: "{{base}}/users?page=2", query: [], headers: [], body: { kind: "none" }, auth: { kind: "none" } },
  });

  it("labels an unbound HTTP draft as a new HTTP request", () => {
    expect(draftBreadcrumb(httpDraft, null)).toEqual(["New HTTP request"]);
  });

  it("falls back to the suggested HTTP name when origin has no names and catalog lacks the id", () => {
    expect(draftBreadcrumb(httpDraft, { collectionId: "c1", requestId: "rX" }, [])).toEqual(["GET users"]);
  });
});
