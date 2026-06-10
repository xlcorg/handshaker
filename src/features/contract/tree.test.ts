import { describe, it, expect } from "vitest";
import type { MessageSchemaIpc, FieldNodeIpc } from "@/ipc/bindings";
import { deriveRows, type ContractRow } from "./tree";

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
        f("byId", "string", "scalar", { oneof_group: "selector" }),
        f("byName", "string", "scalar", { oneof_group: "selector" }),
      ],
    },
    {
      full_name: "t.Filter",
      // self-reference → recursion guard must stop expansion
      fields: [f("tags", "repeated string", "scalar", { repeated: true }), f("nested", "Filter", "message", { message_type: "t.Filter" })],
    },
  ],
  enums: [{ full_name: "t.SortDir", values: ["ASC", "DESC"] }],
};

type FieldRow = Extract<ContractRow, { kind: "field" }>;

describe("deriveRows", () => {
  it("emits root fields at depth 0 with enum values resolved", () => {
    const rows = deriveRows(SCHEMA, new Set());
    const fields = rows.filter((r): r is FieldRow => r.kind === "field");
    expect(fields.map((r) => r.field.json_name)).toEqual(["query", "sort", "filters", "byId", "byName"]);
    expect(fields[0].depth).toBe(0);
    expect(fields[1].enumValues).toEqual(["ASC", "DESC"]);
    expect(fields[2].expandable).toBe(true);
    expect(fields[2].expanded).toBe(false);
  });

  it("inserts a oneof header row before the group's first member", () => {
    const rows = deriveRows(SCHEMA, new Set());
    const i = rows.findIndex((r) => r.kind === "oneof");
    expect(i).toBeGreaterThan(-1);
    expect(rows[i]).toMatchObject({ kind: "oneof", label: "selector" });
    expect(rows[i + 1]).toMatchObject({ kind: "field", field: expect.objectContaining({ json_name: "byId" }) });
    // exactly one header for the two adjacent members
    expect(rows.filter((r) => r.kind === "oneof")).toHaveLength(1);
  });

  it("expands a message field one level when its path is in `expanded`", () => {
    const rows = deriveRows(SCHEMA, new Set(["/filters"]));
    const tags = rows.find((r) => r.kind === "field" && r.field.json_name === "tags");
    expect(tags).toMatchObject({ depth: 1 });
  });

  it("marks a recursive reference un-expandable instead of looping", () => {
    const rows = deriveRows(SCHEMA, new Set(["/filters", "/filters/nested"]));
    const nested = rows.find((r) => r.kind === "field" && r.field.json_name === "nested")!;
    expect(nested.kind === "field" && nested.recursive).toBe(true);
    expect(nested.kind === "field" && nested.expandable).toBe(false);
    // and nothing below it was emitted twice
    expect(rows.filter((r) => r.kind === "field" && r.field.json_name === "nested")).toHaveLength(1);
  });

  it("returns [] for a schema whose root is missing", () => {
    expect(deriveRows({ root: "t.Nope", messages: [], enums: [] }, new Set())).toEqual([]);
  });
});
