import { describe, it, expect } from "vitest";
import { aggregateUsage } from "./sort";
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
