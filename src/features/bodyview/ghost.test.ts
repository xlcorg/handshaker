import { describe, it, expect } from "vitest";
import type { MessageSchemaIpc, FieldNodeIpc } from "@/ipc/bindings";
import { computeGhostLines, GhostZone, ghostDomNode } from "./ghost";

function f(json: string, label: string, kind: FieldNodeIpc["value_kind"], extra: Partial<FieldNodeIpc> = {}): FieldNodeIpc {
  return {
    json_name: json, proto_name: json, type_label: label, value_kind: kind,
    repeated: false, message_type: null, enum_type: null, oneof_group: null, ...extra,
  };
}

const SCHEMA: MessageSchemaIpc = {
  root: "t.Req",
  messages: [
    { full_name: "t.Req", fields: [f("query", "string", "scalar"), f("deadline", "Timestamp", "message", { message_type: "g.Timestamp" })] },
    { full_name: "g.Timestamp", fields: [] },
  ],
  enums: [],
};

describe("computeGhostLines", () => {
  it("lists missing top-level fields above the closing brace", () => {
    const block = computeGhostLines('{\n  "query": "x"\n}', SCHEMA);
    expect(block).toEqual({ afterLine: 2, lines: ['  "deadline": Timestamp'] });
  });

  it("returns null when every field is present", () => {
    expect(computeGhostLines('{\n  "query": "x",\n  "deadline": {}\n}', SCHEMA)).toBeNull();
  });

  it("anchors after the opening brace for an empty object", () => {
    expect(computeGhostLines("{}", SCHEMA)).toEqual({
      afterLine: 1,
      lines: ['  "query": string', '  "deadline": Timestamp'],
    });
  });

  it("anchors after the closing brace of a multi-line last entry", () => {
    const block = computeGhostLines('{\n  "deadline": {\n  }\n}', SCHEMA);
    // deadline spans lines 2-3; the ghost block opens after its closing line
    expect(block).toEqual({ afterLine: 3, lines: ['  "query": string'] });
  });

  it("returns null for invalid JSON, a non-object root, and an unknown schema root", () => {
    expect(computeGhostLines('{ "query": ', SCHEMA)).toBeNull();
    expect(computeGhostLines("[1]", SCHEMA)).toBeNull();
    expect(computeGhostLines("{}", { root: "t.Nope", messages: [], enums: [] })).toBeNull();
  });
});

describe("GhostZone", () => {
  function fakeZoneEditor() {
    const zones = new Map<string, { afterLineNumber: number; heightInLines: number; domNode: HTMLElement }>();
    let n = 0;
    return {
      zones,
      changeViewZones(cb: (acc: { addZone(z: never): string; removeZone(id: string): void }) => void) {
        cb({
          addZone: (z: never) => { const id = `z${n++}`; zones.set(id, z); return id; },
          removeZone: (id: string) => { zones.delete(id); },
        } as never);
      },
    };
  }

  it("adds, replaces and removes the single zone", () => {
    const ed = fakeZoneEditor();
    const gz = new GhostZone(ed);
    gz.apply({ afterLine: 2, lines: ["a", "b"] });
    expect(ed.zones.size).toBe(1);
    const z = [...ed.zones.values()][0];
    expect(z.afterLineNumber).toBe(2);
    expect(z.heightInLines).toBe(2);
    // No manual horizontal offset: Monaco renders a view-zone domNode in the
    // content area (the marginDomNode is the margin-side counterpart), so it
    // already starts at the code's content origin. The ghost text carries its
    // own 2-space indent — adding contentLeft would over-indent it past the
    // real fields by a full gutter width.
    expect(z.domNode.style.paddingLeft).toBe("");

    gz.apply({ afterLine: 1, lines: ["c"] });
    expect(ed.zones.size).toBe(1);
    expect([...ed.zones.values()][0].afterLineNumber).toBe(1);

    gz.apply(null);
    expect(ed.zones.size).toBe(0);
    gz.dispose(); // idempotent
    expect(ed.zones.size).toBe(0);
  });

  it("renders one div per ghost line via textContent (no HTML injection)", () => {
    const node = ghostDomNode(['  "a <b>": X']);
    expect(node.className).toBe("hs-ghost-skeleton");
    expect(node.children).toHaveLength(1);
    expect(node.children[0].textContent).toBe('  "a <b>": X');
    expect(node.innerHTML).not.toContain("<b>");
  });
});
