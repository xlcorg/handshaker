import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ContractView } from "./ContractView";
import type { MessageSchemaIpc } from "@/ipc/bindings";
import { messages } from "@/lib/messages";

const IN: MessageSchemaIpc = {
  root: "t.In",
  messages: [{
    full_name: "t.In",
    fields: [{
      json_name: "query", proto_name: "query", type_label: "string", value_kind: "scalar",
      repeated: false, message_type: null, enum_type: null, oneof_group: null,
      number: 1, optional: false,
    }],
  }],
  enums: [],
};
const OUT: MessageSchemaIpc = {
  root: "t.Out",
  messages: [{ full_name: "t.Out", fields: [] }],
  enums: [],
};

/** Text of every rendered proto line, in document order. */
const renderedLines = (container: HTMLElement) =>
  Array.from(container.querySelectorAll("div.whitespace-pre")).map((d) => d.textContent);

describe("ContractView", () => {
  it("renders both sides at once under the rpc signature", () => {
    const { container } = render(<ContractView method="Search" input={IN} output={OUT} />);
    const lines = renderedLines(container);
    expect(lines[0]).toBe("rpc Search(In) returns (Out);");
    expect(screen.getByText("query")).toBeInTheDocument(); // request field
    expect(lines).toContain("message Out {}"); // response root block
  });

  it("asks to pick a method when none is selected", () => {
    render(<ContractView method="" input={null} output={null} />);
    expect(screen.getByText(messages.contract.pickMethod)).toBeInTheDocument();
  });

  it("shows the unavailable placeholder when both schemas are missing", () => {
    render(<ContractView method="Search" input={null} output={null} />);
    expect(screen.getByText(messages.contract.unavailable)).toBeInTheDocument();
  });

  it("renders the present side and notes the missing one", () => {
    const { container } = render(<ContractView method="Search" input={null} output={OUT} />);
    expect(renderedLines(container)[0]).toBe("rpc Search(?) returns (Out);");
    expect(screen.getByText(messages.contract.schemaUnavailable("Request"))).toBeInTheDocument();
  });

  it("notes a missing response side likewise", () => {
    const { container } = render(<ContractView method="Search" input={IN} output={null} />);
    expect(renderedLines(container)[0]).toBe("rpc Search(In) returns (?);");
    expect(screen.getByText(messages.contract.schemaUnavailable("Response"))).toBeInTheDocument();
  });
});
