import { describe, it, expect } from "vitest";
import { parseJsonTree, flattenVisible } from "./jsonTree";

describe("parseJsonTree", () => {
  it("returns an error tree for invalid JSON", () => {
    const t = parseJsonTree("not json {");
    expect(t.error).not.toBeNull();
    expect(t.rootId).toBeNull();
    expect(t.order).toEqual([]);
  });

  it("classifies scalar kinds and keeps raw values", () => {
    const t = parseJsonTree(`{"s":"hi","n":42,"b":true,"z":null}`);
    expect(t.error).toBeNull();
    const root = t.nodes[t.rootId!];
    expect(root.kind).toBe("object");
    expect(root.childCount).toBe(4);
    const byKey = (k: string) => root.childIds.map((id) => t.nodes[id]).find((n) => n.key === k)!;
    expect(byKey("s").kind).toBe("string");
    expect(byKey("s").value).toBe("hi");
    expect(byKey("n").kind).toBe("number");
    expect(byKey("n").value).toBe(42);
    expect(byKey("b").kind).toBe("boolean");
    expect(byKey("z").kind).toBe("null");
  });

  it("indexes array elements with index + depth and null keys", () => {
    const t = parseJsonTree(`{"tags":["a","b"]}`);
    const root = t.nodes[t.rootId!];
    const tags = t.nodes[root.childIds[0]];
    expect(tags.kind).toBe("array");
    expect(tags.depth).toBe(1);
    const first = t.nodes[tags.childIds[0]];
    expect(first.key).toBeNull();
    expect(first.index).toBe(0);
    expect(first.depth).toBe(2);
    expect(first.value).toBe("a");
  });

  it("gives every node a unique stable id and a full DFS order", () => {
    const t = parseJsonTree(`{"a":{"b":1},"c":2}`);
    expect(new Set(t.order).size).toBe(t.order.length);
    // pre-order: root, a, a.b, c
    expect(t.order.length).toBe(4);
    expect(t.order[0]).toBe(t.rootId);
  });

  it("does not throw on pathologically deep nesting (returns a tree or an error)", () => {
    const deep = "[".repeat(50000) + "1" + "]".repeat(50000);
    expect(() => parseJsonTree(deep)).not.toThrow();
  });
});

describe("flattenVisible", () => {
  it("hides descendants of collapsed containers", () => {
    const t = parseJsonTree(`{"a":{"b":1},"c":2}`);
    const root = t.nodes[t.rootId!];
    const a = t.nodes[root.childIds.find((id) => t.nodes[id].key === "a")!];
    const allVisible = flattenVisible(t, new Set());
    expect(allVisible.map((n) => n.id)).toEqual(t.order); // nothing collapsed → full order
    const collapsed = flattenVisible(t, new Set([a.id]));
    // a is still shown, but a.b is hidden
    expect(collapsed.some((n) => n.id === a.id)).toBe(true);
    expect(collapsed.some((n) => t.nodes[n.id].key === "b")).toBe(false);
  });

  it("returns [] for an error tree", () => {
    expect(flattenVisible(parseJsonTree("oops"), new Set())).toEqual([]);
  });
});
