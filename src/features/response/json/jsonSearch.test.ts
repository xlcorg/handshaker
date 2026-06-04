import { describe, it, expect } from "vitest";
import { findMatches, ancestorsToExpand } from "./jsonSearch";
import { parseJsonTree } from "./jsonTree";

describe("findMatches", () => {
  it("returns [] for a blank query", () => {
    expect(findMatches(parseJsonTree(`{"a":1}`), "   ")).toEqual([]);
  });
  it("matches keys case-insensitively", () => {
    const t = parseJsonTree(`{"userId":1,"name":"x"}`);
    const m = findMatches(t, "USER");
    expect(m).toHaveLength(1);
    expect(m[0].field).toBe("key");
    expect(t.nodes[m[0].nodeId].key).toBe("userId");
  });
  it("matches scalar value text but not container nodes", () => {
    const t = parseJsonTree(`{"city":"Berlin","nested":{"city":"Berlin"}}`);
    const m = findMatches(t, "berlin");
    // two string leaves match on value; the object node "nested" must NOT match
    expect(m.every((x) => x.field === "value")).toBe(true);
    expect(m).toHaveLength(2);
  });
  it("matches numbers by their text form", () => {
    const t = parseJsonTree(`{"port":8443}`);
    expect(findMatches(t, "844")).toHaveLength(1);
  });
});

describe("ancestorsToExpand", () => {
  it("returns the parent chain of a node, nearest-first, excluding the node", () => {
    const t = parseJsonTree(`{"a":{"b":{"c":1}}}`);
    const cId = t.order[t.order.length - 1]; // deepest leaf "c"
    const chain = ancestorsToExpand(t, cId);
    const keys = chain.map((id) => t.nodes[id].key);
    expect(keys).toEqual(["b", "a", null]); // b, a, then root (null key)
  });
});
