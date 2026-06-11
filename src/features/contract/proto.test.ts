import { describe, it, expect } from "vitest";
import type { MessageSchemaIpc, FieldNodeIpc } from "@/ipc/bindings";
import { renderProtoDoc, renderContractDoc, type ProtoBlock, type ProtoToken } from "./proto";

function f(
  proto: string,
  number: number,
  label: string,
  kind: FieldNodeIpc["value_kind"],
  extra: Partial<FieldNodeIpc> = {},
): FieldNodeIpc {
  const json = proto.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
  return {
    json_name: json, proto_name: proto, type_label: label, value_kind: kind,
    number, optional: false, repeated: false, message_type: null, enum_type: null,
    oneof_group: null, ...extra,
  };
}

const lineText = (l: ProtoToken[]) => l.map((t) => t.text).join("");
const blockText = (b: ProtoBlock) => b.lines.map(lineText).join("\n");
const allTokens = (b: ProtoBlock) => b.lines.flat();

const SCHEMA: MessageSchemaIpc = {
  root: "t.Req",
  messages: [
    {
      full_name: "t.Req",
      fields: [
        f("query", 1, "string", "scalar"),
        f("items", 2, "repeated Item", "message", { repeated: true, message_type: "t.Item" }),
        f("filter", 3, "Filter", "message", { message_type: "t.Filter" }),
        f("counts", 4, "map<string, int32>", "map"),
        f("by_id", 5, "map<string, Item>", "map", { message_type: "t.Item" }),
        f("user_id", 6, "string", "scalar", { oneof_group: "target" }),
        f("email", 7, "string", "scalar", { oneof_group: "target" }),
        f("nick", 8, "string", "scalar", { optional: true }),
        f("sort", 9, "Status", "enum", { enum_type: "t.Status" }),
        f("tags", 10, "repeated string", "scalar", { repeated: true }),
        f("states", 11, "map<string, Status>", "map", { enum_type: "t.Status" }),
      ],
    },
    { full_name: "t.Item", fields: [f("name", 1, "string", "scalar")] },
    { full_name: "t.Filter", fields: [f("parent", 1, "Filter", "message", { message_type: "t.Filter" })] },
  ],
  enums: [
    { full_name: "t.Status", values: [{ name: "UNKNOWN", number: 0 }, { name: "ACTIVE", number: 1 }] },
  ],
};

describe("renderProtoDoc", () => {
  it("prints the root message first, then the rest in schema order, then enums", () => {
    const doc = renderProtoDoc(SCHEMA);
    expect(doc.blocks.map((b) => b.fullName)).toEqual(["t.Req", "t.Item", "t.Filter", "t.Status"]);
  });

  it("renders the full proto shape: scalars, repeated, refs, maps, oneof, optional", () => {
    const doc = renderProtoDoc(SCHEMA);
    expect(blockText(doc.blocks[0])).toBe(
      [
        "message Req {",
        "  string query = 1;",
        "  repeated Item items = 2;",
        "  Filter filter = 3;",
        "  map<string, int32> counts = 4;",
        "  map<string, Item> by_id = 5;",
        "  oneof target {",
        "    string user_id = 6;",
        "    string email = 7;",
        "  }",
        "  optional string nick = 8;",
        "  Status sort = 9;",
        "  repeated string tags = 10;",
        "  map<string, Status> states = 11;",
        "}",
      ].join("\n"),
    );
  });

  it("renders enum blocks with value numbers", () => {
    const doc = renderProtoDoc(SCHEMA);
    expect(blockText(doc.blocks[3])).toBe(
      ["enum Status {", "  UNKNOWN = 0;", "  ACTIVE = 1;", "}"].join("\n"),
    );
  });

  it("emits clickable typeRef tokens whose targets all resolve to printed blocks", () => {
    const doc = renderProtoDoc(SCHEMA);
    const printed = new Set(doc.blocks.map((b) => b.fullName));
    const refs = doc.blocks
      .flatMap(allTokens)
      .filter((t): t is Extract<ProtoToken, { kind: "typeRef" }> => t.kind === "typeRef");
    expect(refs).toHaveLength(6); // items, filter, by_id value, sort, states value, parent
    for (const r of refs) expect(printed.has(r.target)).toBe(true);
  });

  it("a recursive self-reference is just a ref to the already-printed block", () => {
    const doc = renderProtoDoc(SCHEMA);
    const filter = doc.blocks.find((b) => b.fullName === "t.Filter")!;
    const ref = allTokens(filter).find((t) => t.kind === "typeRef");
    expect(ref).toMatchObject({ text: "Filter", target: "t.Filter" });
  });

  it("carries tooltips: full name on type names and refs, json_name on field names", () => {
    const doc = renderProtoDoc(SCHEMA);
    const header = doc.blocks[0].lines[0].find((t) => t.kind === "name");
    expect(header).toMatchObject({ text: "Req", tooltip: "t.Req" });
    const byId = doc.blocks[0].lines.find((l) => lineText(l).includes("by_id"))!;
    expect(byId.find((t) => t.kind === "name")).toMatchObject({ text: "by_id", tooltip: "byId" });
    expect(byId.find((t) => t.kind === "typeRef")).toMatchObject({ text: "Item", tooltip: "t.Item" });
  });

  it("a non-contiguous oneof run opens a second block", () => {
    const schema: MessageSchemaIpc = {
      root: "t.M",
      messages: [{
        full_name: "t.M",
        fields: [
          f("a", 1, "string", "scalar", { oneof_group: "g" }),
          f("mid", 2, "string", "scalar"),
          f("b", 3, "string", "scalar", { oneof_group: "g" }),
        ],
      }],
      enums: [],
    };
    const text = blockText(renderProtoDoc(schema).blocks[0]);
    expect(text.match(/oneof g \{/g)).toHaveLength(2);
  });

  it("prints full names when short names collide", () => {
    const schema: MessageSchemaIpc = {
      root: "a.Filter",
      messages: [
        { full_name: "a.Filter", fields: [f("x", 1, "Filter", "message", { message_type: "b.Filter" })] },
        { full_name: "b.Filter", fields: [] },
      ],
      enums: [],
    };
    const doc = renderProtoDoc(schema);
    expect(blockText(doc.blocks[0])).toBe(
      ["message a.Filter {", "  b.Filter x = 1;", "}"].join("\n"),
    );
    expect(blockText(doc.blocks[1])).toBe("message b.Filter {}");
  });

  it("prints an empty message on one line", () => {
    const schema: MessageSchemaIpc = {
      root: "t.Empty",
      messages: [{ full_name: "t.Empty", fields: [] }],
      enums: [],
    };
    expect(blockText(renderProtoDoc(schema).blocks[0])).toBe("message Empty {}");
  });
});

describe("renderContractDoc", () => {
  const IN: MessageSchemaIpc = {
    root: "t.Req",
    messages: [
      {
        full_name: "t.Req",
        fields: [
          f("query", 1, "string", "scalar"),
          f("item", 2, "Item", "message", { message_type: "t.Item" }),
        ],
      },
      { full_name: "t.Item", fields: [f("name", 1, "string", "scalar")] },
    ],
    enums: [],
  };
  const OUT: MessageSchemaIpc = {
    root: "t.Resp",
    messages: [
      {
        full_name: "t.Resp",
        fields: [
          f("items", 1, "repeated Item", "message", { repeated: true, message_type: "t.Item" }),
          f("status", 2, "Status", "enum", { enum_type: "t.Status" }),
        ],
      },
      { full_name: "t.Item", fields: [f("name", 1, "string", "scalar")] },
    ],
    enums: [{ full_name: "t.Status", values: [{ name: "OK", number: 0 }] }],
  };

  it("opens with the rpc signature line referencing both roots", () => {
    const doc = renderContractDoc("Search", IN, OUT);
    expect(doc.blocks[0].fullName).toBe("");
    expect(lineText(doc.blocks[0].lines[0])).toBe("rpc Search(Req) returns (Resp);");
    const refs = doc.blocks[0].lines[0].filter(
      (t): t is Extract<ProtoToken, { kind: "typeRef" }> => t.kind === "typeRef",
    );
    expect(refs.map((r) => r.target)).toEqual(["t.Req", "t.Resp"]);
  });

  it("prints a shared type once, in root-first union order", () => {
    const doc = renderContractDoc("Search", IN, OUT);
    expect(doc.blocks.map((b) => b.fullName)).toEqual(["", "t.Req", "t.Resp", "t.Item", "t.Status"]);
  });

  it("all typeRef targets in the merged doc resolve to printed blocks", () => {
    const doc = renderContractDoc("Search", IN, OUT);
    const printed = new Set(doc.blocks.map((b) => b.fullName));
    const refs = doc.blocks
      .flatMap(allTokens)
      .filter((t): t is Extract<ProtoToken, { kind: "typeRef" }> => t.kind === "typeRef");
    expect(refs.length).toBeGreaterThanOrEqual(5); // rpc(2) + item + items + status
    for (const r of refs) expect(printed.has(r.target)).toBe(true);
  });

  it("renders ? for a missing side and still lists the present side", () => {
    const doc = renderContractDoc("Search", IN, null);
    expect(lineText(doc.blocks[0].lines[0])).toBe("rpc Search(Req) returns (?);");
    expect(doc.blocks.map((b) => b.fullName)).toEqual(["", "t.Req", "t.Item"]);
  });

  it("an identical request and response root prints one block", () => {
    const doc = renderContractDoc("Ping", IN, IN);
    expect(lineText(doc.blocks[0].lines[0])).toBe("rpc Ping(Req) returns (Req);");
    expect(doc.blocks.map((b) => b.fullName)).toEqual(["", "t.Req", "t.Item"]);
  });

  it("resolves short-name collisions across the two sides with full names", () => {
    const a: MessageSchemaIpc = {
      root: "a.Filter",
      messages: [{ full_name: "a.Filter", fields: [] }],
      enums: [],
    };
    const b: MessageSchemaIpc = {
      root: "b.Filter",
      messages: [{ full_name: "b.Filter", fields: [] }],
      enums: [],
    };
    const doc = renderContractDoc("F", a, b);
    expect(lineText(doc.blocks[0].lines[0])).toBe("rpc F(a.Filter) returns (b.Filter);");
  });
});
