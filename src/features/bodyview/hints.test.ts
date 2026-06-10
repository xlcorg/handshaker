import { describe, it, expect } from "vitest";
import type { MessageSchemaIpc, FieldNodeIpc } from "@/ipc/bindings";
import { computeInlayHints } from "./hints";

function f(json: string, label: string, kind: FieldNodeIpc["value_kind"], extra: Partial<FieldNodeIpc> = {}): FieldNodeIpc {
  return {
    json_name: json, proto_name: json, type_label: label, value_kind: kind,
    repeated: false, message_type: null, enum_type: null, oneof_group: null, ...extra,
  };
}

const SCHEMA: MessageSchemaIpc = {
  root: "t.Req",
  messages: [
    {
      full_name: "t.Req",
      fields: [
        f("query", "string", "scalar"),
        f("sort", "SortDir", "enum", { enum_type: "t.SortDir" }),
        f("filters", "Filter", "message", { message_type: "t.Filter" }),
        f("attrs", "map<string, string>", "map"),
        f("items", "repeated Item", "message", { repeated: true, message_type: "t.Item" }),
        f("mood", "Mood", "enum", { enum_type: "t.Mood" }),
      ],
    },
    { full_name: "t.Filter", fields: [f("tags", "repeated string", "scalar", { repeated: true })] },
    { full_name: "t.Item", fields: [f("name", "string", "scalar")] },
  ],
  enums: [
    { full_name: "t.SortDir", values: ["ASC", "DESC"] },
    { full_name: "t.Mood", values: ["A", "B", "C", "D", "E", "F"] },
  ],
};

describe("computeInlayHints", () => {
  it("annotates a scalar value right after its token", () => {
    const text = '{ "query": "alice" }';
    const hints = computeInlayHints(text, SCHEMA);
    expect(hints).toEqual([{ offset: text.indexOf('"alice"') + '"alice"'.length, label: "string" }]);
  });

  it("annotates composite values after the opening brace", () => {
    const text = '{ "filters": { "tags": ["x"] } }';
    const hints = computeInlayHints(text, SCHEMA);
    const open = text.indexOf("{", text.indexOf("filters"));
    expect(hints).toContainEqual({ offset: open + 1, label: "Filter" });
    // nested key resolved through the schema:
    const arr = text.indexOf("[");
    expect(hints).toContainEqual({ offset: arr + 1, label: "repeated string" });
  });

  it("expands enum values in the label (≤5 shown in full)", () => {
    const hints = computeInlayHints('{ "sort": "ASC" }', SCHEMA);
    expect(hints[0].label).toBe("enum SortDir: ASC | DESC");
  });

  it("truncates enum previews past 5 values", () => {
    const hints = computeInlayHints('{ "mood": "A" }', SCHEMA);
    expect(hints[0].label).toBe("enum Mood: A | B | C | D | E | …");
  });

  it("labels the map field itself but skips arbitrary map-entry keys", () => {
    const text = '{ "attrs": { "k1": "v" } }';
    const hints = computeInlayHints(text, SCHEMA);
    expect(hints).toHaveLength(1);
    expect(hints[0].label).toBe("map<string, string>");
  });

  it("resolves keys inside repeated-message array elements", () => {
    const text = '{ "items": [ { "name": "x" } ] }';
    const labels = computeInlayHints(text, SCHEMA).map((h) => h.label);
    expect(labels).toContain("repeated Item");
    expect(labels).toContain("string");
  });

  it("returns [] for invalid JSON and for unknown keys", () => {
    expect(computeInlayHints('{ "query": ', SCHEMA)).toEqual([]);
    expect(computeInlayHints('{ "nope": 1 }', SCHEMA)).toEqual([]);
  });

  it("labels repeated enum field with 'repeated enum' prefix", () => {
    const schema: MessageSchemaIpc = {
      root: "t.R",
      messages: [{ full_name: "t.R", fields: [f("tags", "repeated Dir", "enum", { repeated: true, enum_type: "t.Dir" })] }],
      enums: [{ full_name: "t.Dir", values: ["N", "S"] }],
    };
    const hints = computeInlayHints('{ "tags": "N" }', schema);
    expect(hints[0].label).toBe("repeated enum Dir: N | S");
  });
});
