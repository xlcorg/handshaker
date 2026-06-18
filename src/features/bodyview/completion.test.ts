import { describe, it, expect } from "vitest";
import type { MessageSchemaIpc } from "@/ipc/bindings";
import {
  resolveCompletionContext,
  descendSchema,
  computeSuggestions,
  collectPresentKeys,
  insertionColumns,
  separatorAfter,
  buildVarSuggestions,
} from "./completion";
import type { VarCandidate } from "@/features/vars/candidates";

const VC: VarCandidate[] = [
  { name: "host", value: "api.staging", origin: "env", overrides: true },
  { name: "order_id", value: "42", origin: "collection" },
];

describe("buildVarSuggestions", () => {
  it("maps candidates to var Suggestions filtered by partial, value+origin in detail", () => {
    const out = buildVarSuggestions(VC, "ho", false);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      label: "host",
      kind: "variable",
      insertText: "host}}",          // no closing ahead → append }}
      detail: "api.staging · env (overrides)",
    });
  });
  it("omits the trailing }} when closing is already ahead", () => {
    expect(buildVarSuggestions(VC, "", true)[0].insertText).toBe("host");
  });
  it("returns [] when the partial matches no variable (provider must fall through to schema)", () => {
    // This documents the contract the var-branch fall-through relies on: a stray unclosed
    // `{{` with a partial that matches nothing must produce an empty array so the provider
    // continues to schema key/value completion instead of returning an empty suggestion list.
    expect(buildVarSuggestions(VC, "zzz", false)).toEqual([]);
  });
});

// Schema fixture:
//   M { string title; Address addr; repeated Tag tags; Status status;
//       map<string,int32> counts; map<string,Person> people; bool done }
//   Address { string city; Status status }
//   Tag { string name }            Person { string name }
//   enum Status { UNKNOWN, ACTIVE }
const SCHEMA: MessageSchemaIpc = {
  root: "t.M",
  enums: [{ full_name: "t.Status", values: [{ name: "UNKNOWN", number: 0 }, { name: "ACTIVE", number: 1 }] }],
  messages: [
    {
      full_name: "t.M",
      fields: [
        f("title", "string", "scalar"),
        f("addr", "Address", "message", { message_type: "t.Address" }),
        f("tags", "repeated Tag", "message", { message_type: "t.Tag", repeated: true }),
        f("status", "Status", "enum", { enum_type: "t.Status" }),
        f("counts", "map<string, int32>", "map"),
        f("people", "map<string, Person>", "map", { message_type: "t.Person" }),
        f("done", "bool", "scalar"),
      ],
    },
    { full_name: "t.Address", fields: [f("city", "string", "scalar"), f("status", "Status", "enum", { enum_type: "t.Status" })] },
    { full_name: "t.Tag", fields: [f("name", "string", "scalar")] },
    { full_name: "t.Person", fields: [f("name", "string", "scalar")] },
  ],
};

function f(
  json: string,
  type_label: string,
  value_kind: "scalar" | "message" | "enum" | "map",
  extra: Partial<{ message_type: string; enum_type: string; repeated: boolean; oneof_group: string }> = {},
) {
  return {
    json_name: json,
    proto_name: json,
    type_label,
    value_kind,
    repeated: extra.repeated ?? false,
    message_type: extra.message_type ?? null,
    enum_type: extra.enum_type ?? null,
    oneof_group: extra.oneof_group ?? null,
    number: 1,
    optional: false,
  };
}

const labels = (s: ReturnType<typeof computeSuggestions>) => s.map((x) => x.label);

describe("resolveCompletionContext", () => {
  it("top-level key position", () => {
    expect(resolveCompletionContext("{\n  ")).toEqual({ path: [], where: "key" });
  });
  it("key position while typing a partial key", () => {
    expect(resolveCompletionContext('{ "ti')).toEqual({ path: [], where: "key" });
  });
  it("value position after a colon", () => {
    expect(resolveCompletionContext('{ "status": ')).toEqual({ path: [], where: "value", valueField: "status" });
  });
  it("value position while typing inside a string value", () => {
    expect(resolveCompletionContext('{ "status": "AC')).toEqual({ path: [], where: "value", valueField: "status" });
  });
  it("nested object key position", () => {
    expect(resolveCompletionContext('{ "addr": { ')).toEqual({ path: ["addr"], where: "key" });
  });
  it("inside an array → value/element position with the array's key", () => {
    expect(resolveCompletionContext('{ "tags": [ ')).toEqual({ path: [], where: "value", valueField: "tags" });
  });
  it("inside an array element object → key position", () => {
    expect(resolveCompletionContext('{ "tags": [ { ')).toEqual({ path: ["tags"], where: "key" });
  });
  it("inside a map value object → key position with map-key consumed", () => {
    expect(resolveCompletionContext('{ "people": { "alice": { ')).toEqual({ path: ["people", "alice"], where: "key" });
  });
});

describe("descendSchema", () => {
  it("root", () => {
    expect(descendSchema(SCHEMA, [])).toEqual({ kind: "message", node: SCHEMA.messages[0] });
  });
  it("through a singular message", () => {
    expect(descendSchema(SCHEMA, ["addr"])).toEqual({ kind: "message", node: SCHEMA.messages[1] });
  });
  it("through a repeated message", () => {
    expect(descendSchema(SCHEMA, ["tags"])).toEqual({ kind: "message", node: SCHEMA.messages[2] });
  });
  it("a map field directly → map", () => {
    const d = descendSchema(SCHEMA, ["people"]);
    expect(d?.kind).toBe("map");
  });
  it("through a map value (map key consumed)", () => {
    expect(descendSchema(SCHEMA, ["people", "alice"])).toEqual({ kind: "message", node: SCHEMA.messages[3] });
  });
  it("unknown path → null", () => {
    expect(descendSchema(SCHEMA, ["nope"])).toBeNull();
  });
});

describe("computeSuggestions", () => {
  it("top-level keys are the root message fields", () => {
    expect(labels(computeSuggestions(SCHEMA, "{\n  "))).toEqual([
      "title", "addr", "tags", "status", "counts", "people", "done",
    ]);
  });
  it("nested message keys", () => {
    expect(labels(computeSuggestions(SCHEMA, '{ "addr": { '))).toEqual(["city", "status"]);
  });
  it("enum value suggestions after a colon", () => {
    expect(labels(computeSuggestions(SCHEMA, '{ "status": '))).toEqual(["UNKNOWN", "ACTIVE"]);
  });
  it("bool value suggestions", () => {
    expect(labels(computeSuggestions(SCHEMA, '{ "done": '))).toEqual(["true", "false"]);
  });
  it("map keys are suppressed (arbitrary)", () => {
    expect(computeSuggestions(SCHEMA, '{ "people": { ')).toEqual([]);
  });
  it("map value message keys are offered", () => {
    expect(labels(computeSuggestions(SCHEMA, '{ "people": { "alice": { '))).toEqual(["name"]);
  });
  it("scaffold for a message key is a snippet object", () => {
    const addr = computeSuggestions(SCHEMA, "{\n  ").find((s) => s.label === "addr")!;
    expect(addr.insertText).toBe('"addr": {\n\t$0\n}');
    expect(addr.isSnippet).toBe(true);
    expect(addr.triggerNext).toBe(true);
  });
  it("scaffold for a repeated key is an array", () => {
    const tags = computeSuggestions(SCHEMA, "{\n  ").find((s) => s.label === "tags")!;
    expect(tags.insertText).toBe('"tags": [$0]');
  });
  it("scaffold for a map key is an object, a string key is quoted", () => {
    const counts = computeSuggestions(SCHEMA, "{\n  ").find((s) => s.label === "counts")!;
    expect(counts.insertText).toBe('"counts": {\n\t$0\n}'); // map → object scaffold
    const title = computeSuggestions(SCHEMA, "{\n  ").find((s) => s.label === "title")!;
    expect(title.insertText).toBe('"title": "$0"'); // string → quoted
  });
  it("no schema-less crash on unparseable / unknown paths", () => {
    expect(computeSuggestions(SCHEMA, '{ "nope": { ')).toEqual([]);
  });
});

describe("collectPresentKeys", () => {
  it("collects keys of the innermost object around the caret — both sides of it", () => {
    const text = '{ "title": "x", "done": true }';
    expect(collectPresentKeys(text, 2)).toEqual(new Set(["title", "done"]));
  });

  it("excludes the key token the caret sits in (the property keeps completing itself)", () => {
    const text = '{ "title": "x", "done": true }';
    expect(collectPresentKeys(text, text.indexOf("title") + 2)).toEqual(new Set(["done"]));
  });

  it("scopes to the caret's object, not its parents or siblings", () => {
    const text = '{ "addr": { "city": "a" }, "done": true }';
    const insideAddr = text.indexOf('"city"');
    expect(collectPresentKeys(text, insideAddr)).toEqual(new Set(["city"]));
  });

  it("caret at end of a mid-typing text uses the open frame", () => {
    expect(collectPresentKeys('{ "title": "x", ', 16)).toEqual(new Set(["title"]));
  });

  it("an unterminated string at the caret is not counted as present", () => {
    const text = '{ "title": "x", "do';
    expect(collectPresentKeys(text, text.length)).toEqual(new Set(["title"]));
  });
});

describe("proto field order (sortText)", () => {
  it("key suggestions carry ascending sortText in schema order", () => {
    const sorts = computeSuggestions(SCHEMA, "{\n  ").map((s) => s.sortText);
    expect(sorts).toEqual(["0000", "0001", "0002", "0003", "0004", "0005", "0006"]);
  });

  it("enum value suggestions follow declaration order", () => {
    const sorts = computeSuggestions(SCHEMA, '{ "status": ').map((s) => s.sortText);
    expect(sorts).toEqual(["0000", "0001"]);
  });
});

describe("separatorAfter", () => {
  it("appends a comma when another property follows the insertion point", () => {
    expect(separatorAfter('\n  "userId": ""\n}')).toBe(",");
  });

  it("appends nothing before a closing brace/bracket, an existing comma, or EOF", () => {
    expect(separatorAfter("\n}")).toBe("");
    expect(separatorAfter("]")).toBe("");
    expect(separatorAfter(', "x": 1')).toBe("");
    expect(separatorAfter("")).toBe("");
    expect(separatorAfter("   \n  ")).toBe("");
  });
});

describe("present-key filtering", () => {
  it("hides keys already present in the enclosing object", () => {
    expect(labels(computeSuggestions(SCHEMA, "{\n  ", new Set(["title", "done"])))).toEqual([
      "addr", "tags", "status", "counts", "people",
    ]);
  });

  it("a present oneof member hides its siblings too", () => {
    const oneofSchema: MessageSchemaIpc = {
      root: "t.O",
      enums: [],
      messages: [{
        full_name: "t.O",
        fields: [
          f("byId", "string", "scalar", { oneof_group: "selector" }),
          f("byName", "string", "scalar", { oneof_group: "selector" }),
          f("limit", "int32", "scalar"),
        ],
      }],
    };
    expect(labels(computeSuggestions(oneofSchema, "{\n  ", new Set(["byId"])))).toEqual(["limit"]);
  });

  it("value suggestions are unaffected by present keys", () => {
    expect(labels(computeSuggestions(SCHEMA, '{ "status": ', new Set(["status"])))).toEqual([
      "UNKNOWN", "ACTIVE",
    ]);
  });
});

// Coverage for map<string, Enum> value position + scalar-map non-descent.
//   R { map<string, Status> roles }   enum Status { UNKNOWN, ACTIVE }
const MAP_ENUM_SCHEMA: MessageSchemaIpc = {
  root: "t.R",
  enums: [{ full_name: "t.Status", values: [{ name: "UNKNOWN", number: 0 }, { name: "ACTIVE", number: 1 }] }],
  messages: [
    { full_name: "t.R", fields: [f("roles", "map<string, Status>", "map", { enum_type: "t.Status" })] },
  ],
};

describe("map value suggestions", () => {
  it("a map<string, Enum> value position suggests the enum's values", () => {
    // path resolves to ["roles"] with the map key 'alice' as valueField; descend → {kind:'map'}.
    expect(labels(computeSuggestions(MAP_ENUM_SCHEMA, '{ "roles": { "alice": '))).toEqual([
      "UNKNOWN",
      "ACTIVE",
    ]);
  });

  it("descending past a scalar-valued map returns null", () => {
    // `counts` is map<string,int32>; you cannot descend into a scalar map value.
    expect(descendSchema(SCHEMA, ["counts", "anykey"])).toBeNull();
  });
});

describe("insertionColumns (quote-aware range)", () => {
  it("leaves the word range unchanged outside a string", () => {
    // '"a": ' — caret at column 6 (after the space), empty word, no preceding quote.
    expect(insertionColumns('"a": ', 6, 6)).toEqual({ startColumn: 6, endColumn: 6 });
  });

  it("expands over both quotes when the caret is between empty value quotes", () => {
    // '"a": ""' — caret at column 7, between the value quotes at columns 6 and 7.
    expect(insertionColumns('"a": ""', 7, 7)).toEqual({ startColumn: 6, endColumn: 8 });
  });

  it("expands over a partial token typed inside quotes", () => {
    // '"a": "AC"' — word 'AC' at columns 7-9, opening quote col 6, closing quote col 9.
    expect(insertionColumns('"a": "AC"', 7, 9)).toEqual({ startColumn: 6, endColumn: 10 });
  });

  it("expands left only when there is an opening but no closing quote", () => {
    // '"a": "AC' — unterminated; opening quote col 6, word 'AC' cols 7-9, nothing after.
    expect(insertionColumns('"a": "AC', 7, 9)).toEqual({ startColumn: 6, endColumn: 9 });
  });
});

describe("scalar well-known types (atomic in schema, bare scalar on insert)", () => {
  // The schema reports a WKT field as an ordinary Message (real type name for the
  // contract/ghost) + the wrapper block. Completion must still insert a bare scalar
  // and never descend into the wrapper's `value` field.
  const WKT: MessageSchemaIpc = {
    root: "t.M",
    enums: [],
    messages: [
      {
        full_name: "t.M",
        fields: [
          f("limit", "Int64Value", "message", { message_type: "google.protobuf.Int64Value" }),
          f("nick", "StringValue", "message", { message_type: "google.protobuf.StringValue" }),
          f("flag", "BoolValue", "message", { message_type: "google.protobuf.BoolValue" }),
          f("addr", "Address", "message", { message_type: "t.Address" }),
        ],
      },
      { full_name: "google.protobuf.Int64Value", fields: [f("value", "int64", "scalar")] },
      { full_name: "google.protobuf.StringValue", fields: [f("value", "string", "scalar")] },
      { full_name: "google.protobuf.BoolValue", fields: [f("value", "bool", "scalar")] },
      { full_name: "t.Address", fields: [f("city", "string", "scalar")] },
    ],
  };
  const key = (field: string) => computeSuggestions(WKT, "{\n  ").find((x) => x.label === field);

  it("inserts a bare number for an Int64Value field, not an object", () => {
    const s = key("limit")!;
    // bare number snippet, not the `{ "value": … }` wrapper object
    expect(s.insertText).toBe('"limit": ${1:0}');
    expect(s.triggerNext).toBeFalsy();
  });

  it("inserts a quoted empty string for a StringValue field", () => {
    expect(key("nick")!.insertText).toBe('"nick": "$0"');
  });

  it("inserts a bare bool for a BoolValue field", () => {
    expect(key("flag")!.insertText).toBe('"flag": ${1:false}');
  });

  it("offers true/false as values for a BoolValue field", () => {
    expect(computeSuggestions(WKT, '{ "flag": ').map((x) => x.label)).toEqual(["true", "false"]);
  });

  it("never descends into a wrapper — no `value` suggestion inside the object form", () => {
    expect(descendSchema(WKT, ["limit"])).toBeNull();
    expect(computeSuggestions(WKT, '{ "limit": {\n  ')).toEqual([]);
  });

  it("still expands a normal (non-WKT) message field", () => {
    const s = key("addr")!;
    expect(s.insertText).toContain("{");
    expect(s.triggerNext).toBe(true);
    expect(descendSchema(WKT, ["addr"])?.kind).toBe("message");
  });
});
