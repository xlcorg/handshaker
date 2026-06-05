import { describe, it, expect } from "vitest";
import { renderJsonTree } from "./render";
import { parseWithSpans } from "./parse";
import { spanAtOffset } from "./spans";
import { ELIDE_LIMIT } from "./elide";

const treeOf = (json: string) => parseWithSpans(json)!.tree;

describe("renderJsonTree", () => {
  it("pretty-prints with 2-space indentation", () => {
    const r = renderJsonTree(treeOf(`{"a":1,"b":[2,3]}`));
    expect(r.text).toBe(`{\n  "a": 1,\n  "b": [\n    2,\n    3\n  ]\n}`);
  });

  it("records spans into the rendered text that resolve back to nodes", () => {
    const tree = treeOf(`{"a":1}`);
    const r = renderJsonTree(tree);
    const offset = r.text.indexOf("1");
    const span = spanAtOffset(r.spans, offset)!;
    expect(tree.nodes[span.nodeId].value).toBe(1);
  });

  it("emits a preview + badge for a string over the limit", () => {
    const big = "z".repeat(ELIDE_LIMIT + 1);
    const r = renderJsonTree(treeOf(JSON.stringify({ blob: big })));
    expect(r.badges).toHaveLength(1);
    expect(r.text).not.toContain(big);          // full value not in model text
    expect(r.text).toContain("z".repeat(64));   // preview is
    expect(r.badges[0].label).toMatch(/KB$/);
  });

  it("emits the full value (no badge) when the node id is expanded", () => {
    const big = "z".repeat(ELIDE_LIMIT + 1);
    const tree = treeOf(JSON.stringify({ blob: big }));
    const blobId = tree.nodes[tree.rootId!].childIds[0];
    const r = renderJsonTree(tree, new Set([blobId]));
    expect(r.badges).toHaveLength(0);
    expect(r.text).toContain(big);
  });
});
