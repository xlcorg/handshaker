import { describe, it, expect } from "vitest";
import { suggestSavePath, findSavedLocations } from "./grouping";
import type { CollectionIpc, ItemIpc, SavedRequestIpc } from "@/ipc/bindings";

describe("suggestSavePath", () => {
  it("returns [host, ServiceShortName]", () => {
    expect(suggestSavePath("localhost:5002", "payments.v1.PaymentService")).toEqual([
      "localhost",
      "PaymentService",
    ]);
  });

  it("keeps a templated host and strips the port", () => {
    expect(suggestSavePath("{{host}}:443", "Echo")).toEqual(["{{host}}", "Echo"]);
  });

  it("handles an address with no port", () => {
    expect(suggestSavePath("api.example.com", "pkg.Svc")).toEqual(["api.example.com", "Svc"]);
  });

  it("drops empty segments", () => {
    expect(suggestSavePath("", "")).toEqual([]);
    expect(suggestSavePath("localhost:1", "")).toEqual(["localhost"]);
  });
});

function req(over: Partial<SavedRequestIpc> = {}): ItemIpc {
  return {
    type: "request",
    id: "r",
    name: "GetX",
    address_template: "localhost:5002",
    service: "pkg.v1.Svc",
    method: "GetX",
    body_template: "{}",
    metadata: [],
    auth: { kind: "none" },
    tls_override: null,
    last_used_at: null,
    use_count: 0,
    ...over,
  };
}

function folder(name: string, items: ItemIpc[], id = name): ItemIpc {
  return { type: "folder", id, name, items };
}

function col(over: Partial<CollectionIpc> = {}): CollectionIpc {
  return {
    id: "c",
    name: "C",
    items: [],
    variables: {},
    auth: { kind: "none" },
    default_tls: false,
    skip_tls_verify: false,
    pinned: false,
    description: null,
    created_at: 0,
    ...over,
  };
}

describe("findSavedLocations", () => {
  const match = { service: "pkg.v1.Svc", method: "GetX", address: "localhost:5002" };

  it("finds a nested request matching service+method+address and reports its folder path", () => {
    const target = req({ id: "r1", name: "saved-getx" });
    const collections = [
      col({ id: "c1", name: "Payments", items: [folder("Host", [folder("Svc", [target])])] }),
    ];
    expect(findSavedLocations(collections, match)).toEqual([
      { collectionId: "c1", collectionName: "Payments", folderPath: ["Host", "Svc"], requestId: "r1", requestName: "saved-getx" },
    ]);
  });

  it("ignores requests that differ in any of service/method/address", () => {
    const collections = [
      col({ items: [req({ id: "a", method: "Other" }), req({ id: "b", address_template: "other:1" }), req({ id: "c", service: "pkg.v1.Other" })] }),
    ];
    expect(findSavedLocations(collections, match)).toEqual([]);
  });

  it("reports a top-level request with an empty folder path", () => {
    const collections = [col({ id: "c2", name: "Root", items: [req({ id: "r2" })] })];
    expect(findSavedLocations(collections, match)).toEqual([
      { collectionId: "c2", collectionName: "Root", folderPath: [], requestId: "r2", requestName: "GetX" },
    ]);
  });

  it("aggregates matches across multiple collections", () => {
    const collections = [
      col({ id: "c1", name: "A", items: [req({ id: "r1" })] }),
      col({ id: "c2", name: "B", items: [folder("F", [req({ id: "r2" })])] }),
    ];
    const out = findSavedLocations(collections, match);
    expect(out.map((l) => [l.collectionId, l.requestId, l.folderPath])).toEqual([
      ["c1", "r1", []],
      ["c2", "r2", ["F"]],
    ]);
  });
});
