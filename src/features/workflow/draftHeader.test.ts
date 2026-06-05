import { describe, it, expect } from "vitest";
import { draftBreadcrumb } from "./draftHeader";
import { newStep } from "./model";

const draft = newStep({
  address: "h:443", tls: false, service: "pkg.v1.NotesService", method: "Create",
});

describe("draftBreadcrumb", () => {
  it("returns 'New request' for an unbound draft", () => {
    expect(draftBreadcrumb(draft, null)).toBe("New request");
  });

  it("returns 'Collection › Name' when both names are known", () => {
    expect(
      draftBreadcrumb(draft, {
        collectionId: "c1", requestId: "r1", collectionName: "Notes", requestName: "Create note",
      }),
    ).toBe("Notes › Create note");
  });

  it("uses the request name alone when collection name is missing", () => {
    expect(
      draftBreadcrumb(draft, { collectionId: "c1", requestId: "r1", requestName: "Create note" }),
    ).toBe("Create note");
  });

  it("falls back to service / method when origin has no names", () => {
    expect(draftBreadcrumb(draft, { collectionId: "c1", requestId: "r1" })).toBe(
      "NotesService / Create",
    );
  });
});
