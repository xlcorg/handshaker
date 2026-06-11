import { describe, it, expect } from "vitest";
import type { MessageSchemaIpc, FieldNodeIpc } from "@/ipc/bindings";
import { computeUnknownFieldMarkers } from "./validate";

function f(json: string, label: string, kind: FieldNodeIpc["value_kind"], extra: Partial<FieldNodeIpc> = {}): FieldNodeIpc {
  return {
    json_name: json, proto_name: json, type_label: label, value_kind: kind,
    repeated: false, message_type: null, enum_type: null, oneof_group: null,
    number: 1, optional: false, ...extra,
  };
}

const SCHEMA: MessageSchemaIpc = {
  root: "t.Req",
  enums: [],
  messages: [
    {
      full_name: "t.Req",
      fields: [
        f("query", "string", "scalar"),
        f("deadline", "Ts", "message", { message_type: "g.Ts" }),
        f("labels", "map<string, string>", "map"),
      ],
    },
    { full_name: "g.Ts", fields: [f("seconds", "int64", "scalar")] },
  ],
};

describe("computeUnknownFieldMarkers", () => {
  it("flags an unknown top-level key on its key token (quotes included)", () => {
    const text = '{\n  "query": "x",\n  "bogus": 1\n}';
    const ms = computeUnknownFieldMarkers(text, SCHEMA)!;
    expect(ms).toHaveLength(1);
    expect(text.slice(ms[0].start, ms[0].end)).toBe('"bogus"');
    expect(ms[0].message).toBe('"bogus" is not a field of t.Req');
  });

  it("returns [] when every key is in the contract", () => {
    const text = '{ "query": "x", "deadline": { "seconds": 1 } }';
    expect(computeUnknownFieldMarkers(text, SCHEMA)).toEqual([]);
  });

  it("flags a nested unknown key and names the nested message", () => {
    const text = '{ "deadline": { "nanos": 1 } }';
    const ms = computeUnknownFieldMarkers(text, SCHEMA)!;
    expect(ms).toHaveLength(1);
    expect(text.slice(ms[0].start, ms[0].end)).toBe('"nanos"');
    expect(ms[0].message).toBe('"nanos" is not a field of g.Ts');
  });

  it("resolves keys inside repeated-message array elements (array hops add no path segment)", () => {
    const schema: MessageSchemaIpc = {
      root: "t.R",
      enums: [],
      messages: [
        { full_name: "t.R", fields: [f("items", "repeated Item", "message", { repeated: true, message_type: "t.Item" })] },
        { full_name: "t.Item", fields: [f("name", "string", "scalar")] },
      ],
    };
    expect(computeUnknownFieldMarkers('{ "items": [ { "name": "x" } ] }', schema)).toEqual([]);
    const text = '{ "items": [ { "bogus": 1 } ] }';
    const ms = computeUnknownFieldMarkers(text, schema)!;
    expect(ms).toHaveLength(1);
    expect(text.slice(ms[0].start, ms[0].end)).toBe('"bogus"');
    expect(ms[0].message).toBe('"bogus" is not a field of t.Item');
  });

  it("exempts map values (arbitrary keys)", () => {
    expect(computeUnknownFieldMarkers('{ "labels": { "anything": "v" } }', SCHEMA)).toEqual([]);
  });

  it("does not cascade into the subtree of an unknown field", () => {
    const text = '{ "bogus": { "x": 1 } }';
    const ms = computeUnknownFieldMarkers(text, SCHEMA)!;
    expect(ms).toHaveLength(1);
    expect(text.slice(ms[0].start, ms[0].end)).toBe('"bogus"');
  });

  it("returns null for unparseable text (caller keeps stale markers); repairs trailing commas", () => {
    expect(computeUnknownFieldMarkers('{ "query": ', SCHEMA)).toBeNull();
    const ms = computeUnknownFieldMarkers('{ "bogus": 1, }', SCHEMA)!;
    expect(ms).toHaveLength(1);
  });
});
