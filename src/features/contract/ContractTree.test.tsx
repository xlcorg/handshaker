import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { MessageSchemaIpc, FieldNodeIpc } from "@/ipc/bindings";
import { ContractTree } from "./ContractTree";

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
      fields: [f("tags", "repeated string", "scalar", { repeated: true }), f("nested", "Filter", "message", { message_type: "t.Filter" })],
    },
  ],
  enums: [{ full_name: "t.SortDir", values: ["ASC", "DESC"] }],
};

describe("ContractTree", () => {
  it("renders field names, type labels, enum values and a oneof header", () => {
    render(<ContractTree schema={SCHEMA} />);
    expect(screen.getByText("query")).toBeInTheDocument();
    expect(screen.getAllByText("string", { exact: true }).length).toBeGreaterThan(0);
    expect(screen.getByText(/ASC \| DESC/)).toBeInTheDocument();
    expect(screen.getByText(/oneof selector/i)).toBeInTheDocument();
  });

  it("expands and collapses a message field", async () => {
    const user = userEvent.setup();
    render(<ContractTree schema={SCHEMA} />);
    expect(screen.queryByText("tags")).toBeNull();
    await user.click(screen.getByRole("button", { name: /expand filters/i }));
    expect(screen.getByText("tags")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /collapse filters/i }));
    expect(screen.queryByText("tags")).toBeNull();
  });

  it("marks recursive references and offers no expansion for them", async () => {
    const user = userEvent.setup();
    render(<ContractTree schema={SCHEMA} />);
    await user.click(screen.getByRole("button", { name: /expand filters/i }));
    expect(screen.getByTitle("recursive")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /expand nested/i })).toBeNull();
  });

  it("shows proto_name as the row tooltip", () => {
    render(<ContractTree schema={SCHEMA} />);
    expect(screen.getByTitle("query")).toBeInTheDocument(); // title = proto_name
  });

  it("renders an empty state for a fieldless schema", () => {
    render(<ContractTree schema={{ root: "t.E", messages: [{ full_name: "t.E", fields: [] }], enums: [] }} />);
    expect(screen.getByText(/no fields/i)).toBeInTheDocument();
  });
});
