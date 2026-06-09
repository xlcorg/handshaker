import { describe, it, expect } from "vitest";
import type { MessageSchemaIpc } from "@/ipc/bindings";
import {
  resolveCompletionContext,
  descendSchema,
  computeSuggestions,
} from "./completion";

// Schema fixture:
//   M { string title; Address addr; repeated Tag tags; Status status;
//       map<string,int32> counts; map<string,Person> people; bool done }
//   Address { string city; Status status }
//   Tag { string name }            Person { string name }
//   enum Status { UNKNOWN, ACTIVE }
const SCHEMA: MessageSchemaIpc = {
  root: "t.M",
  enums: [{ full_name: "t.Status", values: ["UNKNOWN", "ACTIVE"] }],
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
  extra: Partial<{ message_type: string; enum_type: string; repeated: boolean }> = {},
) {
  return {
    json_name: json,
    proto_name: json,
    type_label,
    value_kind,
    repeated: extra.repeated ?? false,
    message_type: extra.message_type ?? null,
    enum_type: extra.enum_type ?? null,
    oneof_group: null,
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

// Coverage for map<string, Enum> value position + scalar-map non-descent.
//   R { map<string, Status> roles }   enum Status { UNKNOWN, ACTIVE }
const MAP_ENUM_SCHEMA: MessageSchemaIpc = {
  root: "t.R",
  enums: [{ full_name: "t.Status", values: ["UNKNOWN", "ACTIVE"] }],
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
