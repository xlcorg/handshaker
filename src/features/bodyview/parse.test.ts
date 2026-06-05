import { describe, it, expect } from "vitest";
import { parseWithSpans } from "./parse";

describe("parseWithSpans", () => {
  it("returns null on invalid JSON", () => {
    expect(parseWithSpans("not json {")).toBeNull();
    expect(parseWithSpans(`{ "limit": {{count}} }`)).toBeNull(); // unquoted var
  });

  it("parses scalars and keeps raw values + kinds", () => {
    const r = parseWithSpans(`{"s":"hi","n":42,"b":true,"z":null}`)!;
    expect(r).not.toBeNull();
    const root = r.tree.nodes[r.tree.rootId!];
    expect(root.kind).toBe("object");
    expect(root.childCount).toBe(4);
    const byKey = (k: string) => root.childIds.map((id) => r.tree.nodes[id]).find((n) => n.key === k)!;
    expect(byKey("s").value).toBe("hi");
    expect(byKey("n").value).toBe(42);
    expect(byKey("b").value).toBe(true);
    expect(byKey("z").kind).toBe("null");
  });

  it("treats {{var}} inside a string as a normal string value", () => {
    const r = parseWithSpans(`{"id":"{{userId}}"}`)!;
    const child = r.tree.nodes[r.tree.nodes[r.tree.rootId!].childIds[0]];
    expect(child.value).toBe("{{userId}}");
  });

  it("records a span (incl. quotes/brackets) per value matching source offsets", () => {
    const text = `{"s":"hi"}`;
    const r = parseWithSpans(text)!;
    const span = (id: string) => r.spans.find((s) => s.nodeId === id)!;
    const root = r.tree.nodes[r.tree.rootId!];
    expect(text.slice(span(root.id).start, span(root.id).end)).toBe(`{"s":"hi"}`);
    const child = r.tree.nodes[root.childIds[0]];
    expect(text.slice(span(child.id).start, span(child.id).end)).toBe(`"hi"`);
  });

  it("indexes array elements", () => {
    const r = parseWithSpans(`{"tags":["a","b"]}`)!;
    const tags = r.tree.nodes[r.tree.nodes[r.tree.rootId!].childIds[0]];
    expect(tags.kind).toBe("array");
    expect(tags.childCount).toBe(2);
    expect(r.tree.nodes[tags.childIds[1]].index).toBe(1);
    expect(r.tree.nodes[tags.childIds[1]].value).toBe("b");
  });
});
