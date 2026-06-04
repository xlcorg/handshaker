import { describe, it, expect } from "vitest";
import { flattenLines, type JsonLine } from "./jsonLines";
import { parseJsonTree } from "./jsonTree";

const kinds = (ls: JsonLine[]) => ls.map((l) => l.kind);

describe("flattenLines", () => {
  it("emits open … children … close for an expanded object", () => {
    const t = parseJsonTree(`{"a":{"b":1},"c":2}`);
    const lines = flattenLines(t, new Set());
    // {  "a": {  "b": 1  },  "c": 2  }
    expect(kinds(lines)).toEqual(["open", "open", "leaf", "close", "leaf", "close"]);
  });

  it("adds a trailing comma only when the node is not its parent's last child", () => {
    const t = parseJsonTree(`{"a":{"b":1},"c":2}`);
    const lines = flattenLines(t, new Set());
    const node = (i: number) => t.nodes[lines[i].nodeId];
    expect(node(2).key).toBe("b");
    expect(lines[2]).toMatchObject({ kind: "leaf", trailingComma: false });  // b is last in a
    expect(node(3).key).toBe("a");
    expect(lines[3]).toMatchObject({ kind: "close", trailingComma: true });  // a not last in root
    expect(node(4).key).toBe("c");
    expect(lines[4]).toMatchObject({ kind: "leaf", trailingComma: false });  // c last in root
    expect(lines[5]).toMatchObject({ kind: "close", trailingComma: false }); // root close
  });

  it("collapses a non-empty container to a single folded line", () => {
    const t = parseJsonTree(`{"a":{"b":1},"c":2}`);
    const aId = t.order.find((id) => t.nodes[id].key === "a")!;
    const lines = flattenLines(t, new Set([aId]));
    expect(kinds(lines)).toEqual(["open", "folded", "leaf", "close"]);
    expect(lines[1]).toMatchObject({ kind: "folded", trailingComma: true });
    expect(t.nodes[lines[1].nodeId].key).toBe("a");
  });

  it("renders an empty container as a single leaf line (no close line)", () => {
    const t = parseJsonTree(`{"e":{},"a":[]}`);
    const lines = flattenLines(t, new Set());
    expect(kinds(lines)).toEqual(["open", "leaf", "leaf", "close"]);
    expect(lines[1]).toMatchObject({ kind: "leaf", trailingComma: true });   // e, not last
    expect(lines[2]).toMatchObject({ kind: "leaf", trailingComma: false });  // a, last
  });

  it("handles a root scalar with no key and no comma", () => {
    const t = parseJsonTree(`"hi"`);
    const lines = flattenLines(t, new Set());
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ kind: "leaf", depth: 0, trailingComma: false });
    expect(t.nodes[lines[0].nodeId].key).toBeNull();
  });

  it("handles a root array", () => {
    const t = parseJsonTree(`[1,2]`);
    const lines = flattenLines(t, new Set());
    expect(kinds(lines)).toEqual(["open", "leaf", "leaf", "close"]);
    expect(lines[1]).toMatchObject({ trailingComma: true });
    expect(lines[2]).toMatchObject({ trailingComma: false });
  });

  it("returns [] for an error tree", () => {
    expect(flattenLines(parseJsonTree("oops"), new Set())).toEqual([]);
  });
});
