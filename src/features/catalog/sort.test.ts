import { describe, it, expect } from "vitest";
import { aggregateUsage, sortCollections } from "./sort";
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
  return { type: "folder", id: "f", name: "f", items };
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
