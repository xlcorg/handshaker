import { describe, it, expect, vi } from "vitest";
import type { MessageSchemaIpc, FieldNodeIpc } from "@/ipc/bindings";
import { computeGhostLines, GhostZone, ghostDomNode } from "./ghost";

function f(json: string, label: string, kind: FieldNodeIpc["value_kind"], extra: Partial<FieldNodeIpc> = {}): FieldNodeIpc {
  return {
    json_name: json, proto_name: json, type_label: label, value_kind: kind,
    repeated: false, message_type: null, enum_type: null, oneof_group: null,
    number: 1, optional: false, ...extra,
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

  it("renders between the braces of the empty body template", () => {
    expect(computeGhostLines("{\n}", SCHEMA)).toEqual({
      afterLine: 1,
      lines: ['  "query": string', '  "deadline": Timestamp'],
    });
  });

  it("suppresses the ghost when the object is single-line — no slot above the brace", () => {
    // A view zone only exists BETWEEN lines; rendering after a one-line object
    // would spill the fields outside the braces. Enter inside reveals the ghost.
    expect(computeGhostLines("{}", SCHEMA)).toBeNull();
    expect(computeGhostLines('{ "query": "x" }', SCHEMA)).toBeNull();
  });

  it("suppresses the ghost when the last entry shares the closing brace's line", () => {
    expect(computeGhostLines('{\n  "query": "x" }', SCHEMA)).toBeNull();
  });

  it("anchors after the closing brace of a multi-line last entry", () => {
    const block = computeGhostLines('{\n  "deadline": {\n  }\n}', SCHEMA);
    // deadline spans lines 2-3; the ghost block opens after its closing line
    expect(block).toEqual({ afterLine: 3, lines: ['  "query": string'] });
  });

  it("stays below blank lines inside an empty object (the caret line after Enter)", () => {
    // `{}` + Enter auto-indents to `{` / blank caret line / `}`; the ghost must
    // anchor just above the closing brace, not after `{` — otherwise the block
    // wedges between the brace and the line the user is typing on.
    expect(computeGhostLines("{\n  \n}", SCHEMA)).toEqual({
      afterLine: 2,
      lines: ['  "query": string', '  "deadline": Timestamp'],
    });
  });

  it("stays below a trailing blank line after the last entry", () => {
    const block = computeGhostLines('{\n  "query": "x"\n  \n}', SCHEMA);
    expect(block).toEqual({ afterLine: 3, lines: ['  "deadline": Timestamp'] });
  });

  it("tolerates a trailing comma before the closing brace (the between-fields pause)", () => {
    expect(computeGhostLines('{\n  "query": "x",\n}', SCHEMA)).toEqual({
      afterLine: 2,
      lines: ['  "deadline": Timestamp'],
    });
  });

  it("tolerates nested trailing commas too", () => {
    expect(computeGhostLines('{\n  "deadline": { "seconds": 1, },\n}', SCHEMA)).toEqual({
      afterLine: 2,
      lines: ['  "query": string'],
    });
  });

  it("repair does not revive genuinely invalid JSON", () => {
    expect(computeGhostLines('{ "query": ', SCHEMA)).toBeNull();
  });

  it("returns null for invalid JSON, a non-object root, and an unknown schema root", () => {
    expect(computeGhostLines('{ "query": ', SCHEMA)).toBeNull();
    expect(computeGhostLines("[1]", SCHEMA)).toBeNull();
    expect(computeGhostLines("{}", { root: "t.Nope", messages: [], enums: [] })).toBeNull();
  });

  it("shows a well-known wrapper field by its real type name, not the wrapped scalar", () => {
    const schema: MessageSchemaIpc = {
      root: "t.Req",
      messages: [
        {
          full_name: "t.Req",
          fields: [f("limit", "Int64Value", "message", { message_type: "google.protobuf.Int64Value" })],
        },
        { full_name: "google.protobuf.Int64Value", fields: [f("value", "int64", "scalar")] },
      ],
      enums: [],
    };
    expect(computeGhostLines("{\n}", schema)).toEqual({
      afterLine: 1,
      lines: ['  "limit": Int64Value'],
    });
  });
});

describe("GhostZone", () => {
  function fakeZoneEditor() {
    const zones = new Map<string, { afterLineNumber: number; heightInLines: number; domNode: HTMLElement }>();
    const fontApplied: HTMLElement[] = [];
    let n = 0;
    return {
      zones,
      fontApplied,
      changeViewZones(cb: (acc: { addZone(z: never): string; removeZone(id: string): void }) => void) {
        cb({
          addZone: (z: never) => { const id = `z${n++}`; zones.set(id, z); return id; },
          removeZone: (id: string) => { zones.delete(id); },
        } as never);
      },
      applyFontInfo(target: HTMLElement) { fontApplied.push(target); },
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

  it("copies the editor's font metrics onto the zone dom node", () => {
    // Monaco applies fontInfo (family/size/line-height) only to .view-lines;
    // the sibling .view-zones container inherits the app cascade instead. Without
    // an explicit applyFontInfo the ghost renders in the UI font: rows taller
    // than the reserved heightInLines (vertical drift onto the next real line)
    // and a proportional indent that doesn't line up with the code.
    const ed = fakeZoneEditor();
    const gz = new GhostZone(ed);
    gz.apply({ afterLine: 1, lines: ["x"] });
    const z = [...ed.zones.values()][0];
    expect(ed.fontApplied).toContain(z.domNode);
  });

  it("renders one div per ghost line via textContent (no HTML injection)", () => {
    const node = ghostDomNode(['  "a <b>": X']);
    expect(node.className).toBe("hs-ghost-skeleton");
    expect(node.children).toHaveLength(1);
    expect(node.children[0].textContent).toBe('  "a <b>": X');
    expect(node.innerHTML).not.toContain("<b>");
  });

  it("ghostDomNode forwards a right-click to the handler, suppressing the default + propagation", () => {
    // Monaco won't open its menu over a view zone (it preventDefaults then bails),
    // so the zone forwards the contextmenu itself. Suppressing propagation keeps
    // the editor's own (broken) handler from running.
    const onMenu = vi.fn();
    const node = ghostDomNode(['  "a": X'], onMenu);
    const ev = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
    const pd = vi.spyOn(ev, "preventDefault");
    const sp = vi.spyOn(ev, "stopPropagation");
    // dispatch on a row to also exercise bubbling up to the container listener
    node.children[0].dispatchEvent(ev);
    expect(onMenu).toHaveBeenCalledTimes(1);
    expect(onMenu).toHaveBeenCalledWith(ev);
    expect(pd).toHaveBeenCalled();
    expect(sp).toHaveBeenCalled();
  });

  it("ghostDomNode without a handler ignores a right-click (no throw)", () => {
    const node = ghostDomNode(['  "a": X']);
    expect(() =>
      node.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true })),
    ).not.toThrow();
  });

  it("GhostZone threads the right-click handler through to the rendered zone node", () => {
    const onMenu = vi.fn();
    const ed = fakeZoneEditor();
    const gz = new GhostZone(ed, onMenu);
    gz.apply({ afterLine: 1, lines: ["x"] });
    const z = [...ed.zones.values()][0];
    z.domNode.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
    expect(onMenu).toHaveBeenCalledTimes(1);
  });
});
