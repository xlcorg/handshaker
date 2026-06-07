import { describe, it, expect } from "vitest";
import { aggregateUsage, sortCollections, filterCollections } from "./sort";
import type { CollectionIpc, ItemIpc, SavedRequestIpc } from "@/ipc/bindings";

function req(over: Partial<SavedRequestIpc> = {}): ItemIpc {
  return {
    type: "request",
    id: "r",
    name: "n",
    address_template: "a:1",
    service: "s",
    method: "m",
    body_template: "{}",
    metadata: [],
    auth: { kind: "none" },
    tls_override: null,
    last_used_at: null,
    use_count: 0,
    ...over,
  };
}

function folder(items: ItemIpc[]): ItemIpc {
  return { type: "folder", id: "f", name: "f", items, expanded: false };
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
    expanded: false,
    ...over,
  };
}

describe("aggregateUsage", () => {
  it("sums use_count and takes the max last_used_at across nested requests", () => {
    const c = col({
      items: [
        req({ use_count: 2, last_used_at: 100 }),
        folder([req({ use_count: 3, last_used_at: 200 }), req({ use_count: 1, last_used_at: null })]),
      ],
    });
    expect(aggregateUsage(c)).toEqual({ lastUsedAt: 200, useCount: 6 });
  });

  it("reports null lastUsedAt and 0 useCount for an unused/empty collection", () => {
    expect(aggregateUsage(col())).toEqual({ lastUsedAt: null, useCount: 0 });
    expect(aggregateUsage(col({ items: [req()] }))).toEqual({ lastUsedAt: null, useCount: 0 });
  });
});

describe("sortCollections", () => {
  it("alpha: orders by name A->Z", () => {
    const out = sortCollections([col({ name: "B" }), col({ name: "A" }), col({ name: "C" })], "alpha");
    expect(out.map((c) => c.name)).toEqual(["A", "B", "C"]);
  });

  it("floats pinned collections above unpinned, sorted within each group", () => {
    const out = sortCollections(
      [col({ name: "A" }), col({ name: "Z", pinned: true }), col({ name: "M", pinned: true })],
      "alpha",
    );
    expect(out.map((c) => c.name)).toEqual(["M", "Z", "A"]);
  });

  it("created: newest created_at first", () => {
    const out = sortCollections(
      [col({ name: "old", created_at: 1 }), col({ name: "new", created_at: 9 })],
      "created",
    );
    expect(out.map((c) => c.name)).toEqual(["new", "old"]);
  });

  it("created: breaks equal-created_at ties by name", () => {
    const out = sortCollections(
      [col({ name: "B", created_at: 5 }), col({ name: "A", created_at: 5 })],
      "created",
    );
    expect(out.map((c) => c.name)).toEqual(["A", "B"]);
  });

  it("recent: highest aggregated last_used_at first, unused last", () => {
    const out = sortCollections(
      [
        col({ name: "stale", items: [req({ last_used_at: 5 })] }),
        col({ name: "fresh", items: [req({ last_used_at: 50 })] }),
        col({ name: "never", items: [req({ last_used_at: null })] }),
      ],
      "recent",
    );
    expect(out.map((c) => c.name)).toEqual(["fresh", "stale", "never"]);
  });

  it("frequency: highest summed use_count first", () => {
    const out = sortCollections(
      [
        col({ name: "lo", items: [req({ use_count: 1 })] }),
        col({ name: "hi", items: [req({ use_count: 9 })] }),
      ],
      "frequency",
    );
    expect(out.map((c) => c.name)).toEqual(["hi", "lo"]);
  });

  it("does not mutate the input array", () => {
    const input = [col({ name: "B" }), col({ name: "A" })];
    sortCollections(input, "alpha");
    expect(input.map((c) => c.name)).toEqual(["B", "A"]);
  });
});

describe("filterCollections", () => {
  it("returns the input unchanged for an empty/whitespace query", () => {
    const input = [col({ name: "A" })];
    expect(filterCollections(input, "   ")).toBe(input);
  });

  it("keeps only requests matching service/method/address and prunes siblings + empty branches", () => {
    const hit = req({ id: "hit", service: "payments.v1.Pay", method: "Charge" });
    const miss = req({ id: "miss", service: "orders.v1.Ord", method: "List" });
    const out = filterCollections(
      [
        col({ id: "c1", name: "C1", items: [folder([hit, miss])] }),
        col({ id: "c2", name: "C2", items: [miss] }),
      ],
      "charge",
    );
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe("c1");
    const f = out[0].items[0];
    expect(f.type).toBe("folder");
    if (f.type === "folder") {
      expect(f.items.map((i) => i.id)).toEqual(["hit"]);
    }
  });

  it("matches a request by name", () => {
    const out = filterCollections([col({ items: [req({ id: "x", name: "GetBalance" })] })], "balance");
    expect(out[0].items.map((i) => i.id)).toEqual(["x"]);
  });

  it("keeps a folder's whole subtree when the folder name matches", () => {
    const keep = folder([req({ id: "a" }), req({ id: "b" })]);
    if (keep.type === "folder") keep.name = "Billing";
    const out = filterCollections([col({ items: [keep] })], "bill");
    const f = out[0].items[0];
    expect(f.type === "folder" && f.items.map((i) => i.id)).toEqual(["a", "b"]);
  });

  it("keeps a whole collection when the collection name matches", () => {
    const out = filterCollections([col({ id: "c", name: "Payments", items: [req({ id: "a" })] })], "paym");
    expect(out).toHaveLength(1);
    expect(out[0].items.map((i) => i.id)).toEqual(["a"]);
  });

  it("returns [] when nothing matches", () => {
    expect(filterCollections([col({ items: [req()] })], "zzz")).toEqual([]);
  });

  it("does not mutate the input collection", () => {
    const input = [col({ id: "c", name: "C", items: [req({ id: "a" }), req({ id: "b", name: "keep" })] })];
    filterCollections(input, "keep");
    expect(input[0].items).toHaveLength(2);
  });
});
