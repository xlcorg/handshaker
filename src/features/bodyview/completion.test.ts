import { describe, it, expect } from "vitest";
import type { MessageSchemaIpc } from "@/ipc/bindings";
import { descendSchema, computeCompletion } from "./completion";
import type { VarCandidate } from "@/features/vars/candidates";

const VC: VarCandidate[] = [
  { name: "host", value: "api.staging", origin: "env", overrides: true },
  { name: "order_id", value: "42", origin: "collection" },
];

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

// Coverage for map<string, Enum> value position + scalar-map non-descent.
//   R { map<string, Status> roles }   enum Status { UNKNOWN, ACTIVE }
const MAP_ENUM_SCHEMA: MessageSchemaIpc = {
  root: "t.R",
  enums: [{ full_name: "t.Status", values: [{ name: "UNKNOWN", number: 0 }, { name: "ACTIVE", number: 1 }] }],
  messages: [
    { full_name: "t.R", fields: [f("roles", "map<string, Status>", "map", { enum_type: "t.Status" })] },
  ],
};

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

// A schema whose fields have DIFFERENT proto (snake_case) and JSON (camelCase) names.
const SNAKE_SCHEMA: MessageSchemaIpc = {
  root: "t.M",
  enums: [],
  messages: [
    {
      full_name: "t.M",
      fields: [
        {
          json_name: "taxRegistrationCode", proto_name: "tax_registration_code",
          type_label: "string", value_kind: "scalar", repeated: false,
          message_type: null, enum_type: null, oneof_group: null, number: 1, optional: false,
        },
        {
          json_name: "billingAddress", proto_name: "billing_address",
          type_label: "Address", value_kind: "message", repeated: false,
          message_type: "t.Address", enum_type: null, oneof_group: null, number: 2, optional: false,
        },
      ],
    },
    {
      full_name: "t.Address",
      fields: [
        {
          json_name: "postalCode", proto_name: "postal_code",
          type_label: "string", value_kind: "scalar", repeated: false,
          message_type: null, enum_type: null, oneof_group: null, number: 1, optional: false,
        },
      ],
    },
  ],
};

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

/** Split "text│text" into (fullText, caretOffset) at the │ marker. */
function at(textWithCaret: string): { fullText: string; caretOffset: number } {
  const caretOffset = textWithCaret.indexOf("│");
  if (caretOffset === -1) throw new Error("test text has no │ caret marker");
  return { fullText: textWithCaret.replace("│", ""), caretOffset };
}

function complete(
  text: string,
  opts: { schema?: MessageSchemaIpc | null; vars?: VarCandidate[] | null } = {},
) {
  const { fullText, caretOffset } = at(text);
  return computeCompletion(fullText, caretOffset, {
    schema: opts.schema === undefined ? SCHEMA : opts.schema,
    vars: opts.vars ?? null,
  });
}

describe("computeCompletion — orchestration", () => {
  it("var branch wins when {{ is open and a candidate matches", () => {
    const r = complete('{ "title": "{{ho│" }', { vars: VC });
    expect(r.source).toBe("vars");
    expect(r.suggestions.map((s) => s.label)).toContain("host");
    // `{{` sits at offset 12; range covers just-after-`{{` (col 15) → caret (col 17).
    expect(r.suggestions[0].range).toEqual({
      startLineNumber: 1, startColumn: 15, endLineNumber: 1, endColumn: 17,
    });
  });

  it("var insertText appends }} unless a closing }} is already ahead", () => {
    const open = complete('{ "t": "{{ho│" }', { vars: VC });
    expect(open.suggestions[0].insertText.endsWith("}}")).toBe(true);
    const closed = complete('{ "t": "{{ho│}}" }', { vars: VC });
    expect(closed.suggestions[0].insertText.endsWith("}}")).toBe(false);
  });

  it("zero var matches falls through to schema completion", () => {
    const r = complete('{ "{{zzz│ }', { vars: VC });
    expect(r.source).toBe("schema"); // stray {{ is not a var context; keys still offered
    expect(r.suggestions.map((s) => s.label)).toContain("title");
  });

  it("no schema and no vars → source null, no suggestions", () => {
    const r = complete("{ │ }", { schema: null });
    expect(r).toEqual({ source: null, suggestions: [] });
  });

  it("insideString: quoted filterText and range extended over the quotes", () => {
    const r = complete('{ "ti│" }');
    const title = r.suggestions.find((s) => s.label === "title")!;
    expect(title.filterText).toBe('"title"');
    // Word ti = cols 4-6; insertionColumns extends over both quotes → 3..7.
    expect(title.range).toEqual({
      startLineNumber: 1, startColumn: 3, endLineNumber: 1, endColumn: 7,
    });
  });

  it("keyOnly when a colon is already ahead: bare quoted key, no snippet, no re-trigger", () => {
    // Bare key typed in front of an existing `:` — only the quoted key is inserted.
    const r = complete("{ ad│: {} }");
    const addr = r.suggestions.find((s) => s.label === "addr")!;
    expect(addr.insertText).toBe('"addr"');
    expect(addr.isSnippet).toBeFalsy();
    expect(addr.triggerNext).toBeFalsy();
  });

  it("separator comma when another property follows the replaced range", () => {
    const r = complete('{\n  │\n  "done": true\n}');
    const title = r.suggestions.find((s) => s.label === "title")!;
    expect(title.insertText.endsWith(",")).toBe(true);
    expect(title.range.startLineNumber).toBe(2); // multi-line position math
  });

  it("no separator before a closing brace", () => {
    const r = complete("{ │ }");
    const title = r.suggestions.find((s) => s.label === "title")!;
    expect(title.insertText.endsWith(",")).toBe(false);
  });

  it("value context: enum values as plain (non-snippet) inserts", () => {
    const r = complete('{ "status": │ }');
    expect(r.source).toBe("schema");
    expect(r.suggestions.map((s) => s.label)).toEqual(["UNKNOWN", "ACTIVE"]);
    expect(r.suggestions[0].insertText).toBe('"UNKNOWN"');
  });
});

// was: describe("buildVarSuggestions")
describe("computeCompletion — variable suggestions", () => {
  it("var partial filters candidates case-insensitively, detail is value+origin", () => {
    const r = complete('{ "u": "{{HO│" }', { vars: VC });
    expect(r.suggestions.map((s) => s.label)).toEqual(["host"]);
    expect(r.suggestions[0].detail).toBe("api.staging · env (overrides)");
  });
  // closingAhead / zero-matches-falls-through are covered above in
  // "computeCompletion — orchestration".
});

// was: describe("resolveCompletionContext")
describe("computeCompletion — cursor/path resolution", () => {
  it("top-level key position lists root fields", () => {
    const r = complete("{ │ }");
    expect(r.suggestions.map((s) => s.label)).toEqual([
      "title", "addr", "tags", "status", "counts", "people", "done",
    ]);
  });

  it("caret mid partial key still resolves key position (unterminated string doesn't confuse context)", () => {
    const r = complete('{ "ti│');
    expect(r.suggestions.map((s) => s.label)).toContain("title");
  });

  // "value position after a colon" / "inside a string value" are covered by
  // "computeCompletion — orchestration > value context: enum values..." and by
  // "computeCompletion — quote-aware ranges" below.

  it("keys inside addr come from t.Address", () => {
    const r = complete('{ "addr": { │ } }');
    expect(r.suggestions.map((s) => s.label)).toEqual(["city", "status"]);
  });

  it("inside an array value position offers nothing (element needs its own object)", () => {
    const r = complete('{ "tags": [ │');
    expect(r).toEqual({ source: null, suggestions: [] });
  });

  it("inside an array element object, keys come from the element type", () => {
    const r = complete('{ "tags": [ { │');
    expect(r.suggestions.map((s) => s.label)).toEqual(["name"]);
  });

  it("inside a map value object, keys come from the map's value type (map key consumed)", () => {
    const r = complete('{ "people": { "alice": { │ } } }');
    expect(r.suggestions.map((s) => s.label)).toEqual(["name"]);
  });
});

// was: describe("computeSuggestions")
describe("computeCompletion — key & value suggestions", () => {
  it("bool field suggests true/false", () => {
    const r = complete('{ "done": │ }');
    expect(r.suggestions.map((s) => s.label)).toEqual(["true", "false"]);
  });

  it("map object keys are suppressed (arbitrary map key)", () => {
    const r = complete('{ "people": { │ } }');
    expect(r).toEqual({ source: null, suggestions: [] });
  });

  it("message key suggestion scaffolds a snippet object with triggerNext", () => {
    const r = complete("{ │ }");
    const addr = r.suggestions.find((s) => s.label === "addr")!;
    expect(addr.insertText).toBe('"addr": {\n\t$0\n}');
    expect(addr.isSnippet).toBe(true);
    expect(addr.triggerNext).toBe(true);
  });

  it("repeated field key suggestion scaffolds an array", () => {
    const r = complete("{ │ }");
    const tags = r.suggestions.find((s) => s.label === "tags")!;
    expect(tags.insertText).toBe('"tags": [$0]');
  });

  it("map field key suggestion scaffolds an object; scalar field is quoted", () => {
    const r = complete("{ │ }");
    expect(r.suggestions.find((s) => s.label === "counts")!.insertText).toBe('"counts": {\n\t$0\n}');
    expect(r.suggestions.find((s) => s.label === "title")!.insertText).toBe('"title": "$0"');
  });

  it("unknown path yields no suggestions, no crash", () => {
    const r = complete('{ "nope": { │ } }');
    expect(r).toEqual({ source: null, suggestions: [] });
  });
});

// was: describe("proto field order (sortText)")
describe("computeCompletion — proto field order (sortText)", () => {
  it("key suggestions carry ascending sortText in schema declaration order", () => {
    const r = complete("{ │ }");
    expect(r.suggestions.map((s) => s.sortText)).toEqual(["0000", "0001", "0002", "0003", "0004", "0005", "0006"]);
  });

  it("enum value suggestions carry ascending sortText in declaration order", () => {
    const r = complete('{ "status": │ }');
    expect(r.suggestions.map((s) => s.sortText)).toEqual(["0000", "0001"]);
  });
});

// was: describe("collectPresentKeys") + describe("present-key filtering")
describe("computeCompletion — present-key filtering", () => {
  it("present keys are hidden from key suggestions", () => {
    const r = complete('{ "title": "x", │ }');
    expect(r.suggestions.map((s) => s.label)).not.toContain("title");
  });

  it("present keys are collected from the whole object, not just before the caret", () => {
    const r = complete('{ │ "title": "x", "done": true }');
    expect(r.suggestions.map((s) => s.label)).not.toContain("title");
    expect(r.suggestions.map((s) => s.label)).not.toContain("done");
  });

  it("the key token the caret sits in keeps completing itself; other present keys stay hidden", () => {
    const r = complete('{ "ti│tle": "x", "done": true }');
    expect(r.suggestions.map((s) => s.label)).toContain("title");
    expect(r.suggestions.map((s) => s.label)).not.toContain("done");
  });

  it("present-key hiding scopes to the caret's object, not parents or siblings", () => {
    const r = complete('{ "addr": { "city": "a", │ }, "done": true }');
    expect(r.suggestions.map((s) => s.label)).toEqual(["status"]);
  });

  it("present-key hiding still works while the object is still open (no closing brace yet)", () => {
    const r = complete('{ "title": "x", │');
    expect(r.suggestions.map((s) => s.label)).not.toContain("title");
    expect(r.suggestions.map((s) => s.label)).toContain("addr");
  });

  it("an unterminated string at the caret is not counted as present (lenient mid-typing degradation)", () => {
    const r = complete('{ "title": "x", "do│');
    expect(r.suggestions.map((s) => s.label)).not.toContain("title");
  });

  it("hides multiple already-present keys from key suggestions", () => {
    const r = complete('{ "title": "x", "done": true, │ }');
    expect(r.suggestions.map((s) => s.label)).toEqual(["addr", "tags", "status", "counts", "people"]);
  });

  it("a present oneof member hides its sibling fields too", () => {
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
    const r = complete('{ "byId": "x", │ }', { schema: oneofSchema });
    expect(r.suggestions.map((s) => s.label)).toEqual(["limit"]);
  });

  // "value suggestions unaffected by present keys" is covered by
  // "computeCompletion — orchestration > value context: enum values...".
});

// was: describe("map value suggestions")
describe("computeCompletion — map value suggestions", () => {
  it("a map<string, Enum> value position suggests the enum's values", () => {
    const r = complete('{ "roles": { "alice": │ } }', { schema: MAP_ENUM_SCHEMA });
    expect(r.suggestions.map((s) => s.label)).toEqual(["UNKNOWN", "ACTIVE"]);
  });

  it("cannot descend past a scalar-valued map (counts is map<string,int32>)", () => {
    const r = complete('{ "counts": { "x": { │ } } }');
    expect(r).toEqual({ source: null, suggestions: [] });
  });
});

// was: describe("insertionColumns (quote-aware range)") + describe("separatorAfter")
describe("computeCompletion — quote-aware ranges & separators", () => {
  it("outside a string, the range is just the caret (no quote expansion)", () => {
    const r = complete("{ │ }");
    const title = r.suggestions.find((s) => s.label === "title")!;
    expect(title.range).toEqual({ startLineNumber: 1, startColumn: 3, endLineNumber: 1, endColumn: 3 });
  });

  it("expands over both quotes for an empty enum value slot", () => {
    const r = complete('{ "status": "│" }');
    const u = r.suggestions.find((s) => s.label === "UNKNOWN")!;
    expect(u.range).toEqual({ startLineNumber: 1, startColumn: 13, endLineNumber: 1, endColumn: 15 });
  });

  it("expands left only when there's an opening but no closing quote (mid-typing value)", () => {
    // Also covers "resolveCompletionContext: value position while typing inside a string value".
    const r = complete('{ "status": "AC│');
    expect(r.source).toBe("schema");
    const u = r.suggestions.find((s) => s.label === "UNKNOWN")!;
    expect(u.range).toEqual({ startLineNumber: 1, startColumn: 13, endLineNumber: 1, endColumn: 16 });
  });

  // "expands over a partial token typed inside quotes" is covered by
  // "computeCompletion — orchestration > insideString: quoted filterText...".

  it("no separator when a comma already follows the insertion point", () => {
    const r = complete('{ │, "done": true }');
    const title = r.suggestions.find((s) => s.label === "title")!;
    expect(title.insertText.endsWith(",")).toBe(false);
  });

  // "no separator before a closing brace" is covered by
  // "computeCompletion — orchestration > no separator before a closing brace".
});

// was: describe("scalar well-known types (atomic in schema, bare scalar on insert)")
describe("computeCompletion — scalar well-known types (atomic in schema, bare scalar on insert)", () => {
  it("inserts a bare number for an Int64Value field, not an object", () => {
    const r = complete("{ │ }", { schema: WKT });
    const limit = r.suggestions.find((s) => s.label === "limit")!;
    expect(limit.insertText).toBe('"limit": ${1:0}');
    expect(limit.triggerNext).toBeFalsy();
  });

  it("inserts a quoted empty string for a StringValue field", () => {
    const r = complete("{ │ }", { schema: WKT });
    expect(r.suggestions.find((s) => s.label === "nick")!.insertText).toBe('"nick": "$0"');
  });

  it("inserts a bare bool for a BoolValue field", () => {
    const r = complete("{ │ }", { schema: WKT });
    expect(r.suggestions.find((s) => s.label === "flag")!.insertText).toBe('"flag": ${1:false}');
  });

  it("offers true/false as values for a BoolValue field", () => {
    const r = complete('{ "flag": │ }', { schema: WKT });
    expect(r.suggestions.map((s) => s.label)).toEqual(["true", "false"]);
  });

  it("never descends into a wrapper — no `value` suggestion inside the object form", () => {
    expect(descendSchema(WKT, ["limit"])).toBeNull();
    const r = complete('{ "limit": { │ } }', { schema: WKT });
    expect(r).toEqual({ source: null, suggestions: [] });
  });

  it("still expands a normal (non-WKT) message field", () => {
    const r = complete("{ │ }", { schema: WKT });
    const addr = r.suggestions.find((s) => s.label === "addr")!;
    expect(addr.insertText).toContain("{");
    expect(addr.triggerNext).toBe(true);
    expect(descendSchema(WKT, ["addr"])?.kind).toBe("message");
  });
});

// was: describe("proto snake_case field names")
describe("computeCompletion — proto snake_case field names", () => {
  it("inserts the snake_case (proto) name, not camelCase", () => {
    const r = complete("{ │ }", { schema: SNAKE_SCHEMA });
    const tax = r.suggestions.find((s) => s.label === "tax_registration_code");
    expect(tax).toBeDefined();
    expect(tax!.insertText).toBe('"tax_registration_code": "$0"');
    expect(r.suggestions.map((s) => s.label)).not.toContain("taxRegistrationCode");
  });

  it("nested key completion works through the legacy camelCase path segment", () => {
    const r = complete('{ "billingAddress": { │ } }', { schema: SNAKE_SCHEMA });
    expect(r.suggestions.map((s) => s.label)).toContain("postal_code");
  });

  it("does not re-offer a field already present under its camelCase form", () => {
    const r = complete('{ "taxRegistrationCode": "x", │ }', { schema: SNAKE_SCHEMA });
    expect(r.suggestions.map((s) => s.label)).not.toContain("tax_registration_code");
  });
});
