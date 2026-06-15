import { describe, it, expect } from "vitest";
import type { CollectionIpc, ItemIpc, SavedRequestIpc } from "@/ipc/bindings";
import { derivePaletteResults, bestCollectionMatch, completionFor } from "./paletteModel";

function req(id: string, name: string, over: Partial<SavedRequestIpc> = {}): ItemIpc {
  return {
    type: "request", id, name, address_template: "h:443", service: "edo.attorney.v1.Letters",
    method: name, body_template: "{}", metadata: [], auth: { kind: "none" },
    tls_override: null, last_used_at: null, use_count: 0, ...over,
  };
}
function col(id: string, name: string, items: ItemIpc[]): CollectionIpc {
  return {
    id, name, items, variables: {}, auth: { kind: "none" }, default_tls: false,
    skip_tls_verify: false, pinned: false, description: null, created_at: 0, expanded: false,
  };
}
const TREE: CollectionIpc[] = [
  col("c1", "edo-attorney-letters", [req("r1", "Search"), req("r2", "SearchByInn"), req("r3", "GetStatus")]),
  col("c2", "edo-billing", [req("r4", "Charge")]),
];
const LIMITS = { collections: 6, requests: 8 };

describe("derivePaletteResults — flat", () => {
  it("yields no groups for an empty query (hint shown by the component)", () => {
    const r = derivePaletteResults({ tree: TREE, scope: null, query: "  ", limits: LIMITS });
    expect(r.groups).toEqual([]);
    expect(r.rows).toEqual([]);
  });

  it("groups Collections then Requests for a matching query", () => {
    const r = derivePaletteResults({ tree: TREE, scope: null, query: "edo", limits: LIMITS });
    expect(r.groups.map((g) => g.heading)).toEqual(["Collections", "Requests"]);
    const cols = r.groups[0].rows;
    expect(cols.every((row) => row.kind === "collection")).toBe(true);
    expect(cols.map((row) => (row.kind === "collection" ? row.collection.id : "")).sort()).toEqual(["c1", "c2"]);
  });

  it("assigns unique sequential values across all rows", () => {
    const r = derivePaletteResults({ tree: TREE, scope: null, query: "edo", limits: LIMITS });
    const values = r.rows.map((row) => row.value);
    expect(new Set(values).size).toBe(values.length);
    expect(values[0]).toBe("r0");
  });

  it("caps collections and requests at the given limits", () => {
    const big = Array.from({ length: 10 }, (_, i) => col(`x${i}`, `edo-x${i}`, [req(`q${i}`, `Edo${i}`)]));
    const r = derivePaletteResults({ tree: big, scope: null, query: "edo", limits: { collections: 6, requests: 8 } });
    expect(r.groups[0].rows.length).toBe(6);
    expect(r.groups[1].rows.length).toBe(8);
  });
});

describe("derivePaletteResults — scoped", () => {
  const scope = { id: "c1", name: "edo-attorney-letters" };

  it("shows an overview row first then methods when the query is empty", () => {
    const r = derivePaletteResults({ tree: TREE, scope, query: "", limits: LIMITS });
    expect(r.rows[0].kind).toBe("overview");
    expect(r.groups[1].heading).toBe("edo-attorney-letters · methods");
    expect(r.groups[1].rows.map((row) => (row.kind === "request" ? row.request.id : ""))).toContain("r1");
  });

  it("drops the overview row once the user types a method query", () => {
    const r = derivePaletteResults({ tree: TREE, scope, query: "sea", limits: LIMITS });
    expect(r.rows.some((row) => row.kind === "overview")).toBe(false);
    const ids = r.rows.map((row) => (row.kind === "request" ? row.request.id : ""));
    expect(ids).toContain("r1");
    expect(ids).toContain("r2");
    expect(ids).not.toContain("r3");
  });
});

describe("bestCollectionMatch", () => {
  it("returns null for an empty query", () => {
    expect(bestCollectionMatch(TREE, "  ", null)).toBeNull();
  });
  it("prefers the highlighted collection when one is given", () => {
    expect(bestCollectionMatch(TREE, "edo", "c2")).toEqual({ id: "c2", name: "edo-billing" });
  });
  it("falls back to the top-ranked collection", () => {
    expect(bestCollectionMatch(TREE, "edo-attorney", null)).toEqual({ id: "c1", name: "edo-attorney-letters" });
  });
});

describe("completionFor", () => {
  it("completes a request to its name and ignores non-requests", () => {
    const r = derivePaletteResults({ tree: TREE, scope: { id: "c1", name: "edo-attorney-letters" }, query: "sea", limits: LIMITS });
    const reqRow = r.rows.find((row) => row.kind === "request")!;
    expect(completionFor(reqRow)).toBe("Search");
    const overviewRow = derivePaletteResults({ tree: TREE, scope: { id: "c1", name: "edo-attorney-letters" }, query: "", limits: LIMITS }).rows[0];
    expect(completionFor(overviewRow)).toBeNull();
  });
});
