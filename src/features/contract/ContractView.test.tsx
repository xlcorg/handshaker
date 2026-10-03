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
    const { container } = render(<ContractView method="Search" input={IN} output={OUT} kind="unary" />);
    const lines = renderedLines(container);
    expect(lines[0]).toBe("rpc Search(In) returns (Out);");
    expect(screen.getByText("query")).toBeInTheDocument(); // request field
    expect(lines).toContain("message Out {}"); // response root block
  });

  it("prints the stream modifier on the streaming side, types still clickable", () => {
    const { container } = render(<ContractView method="Watch" input={IN} output={OUT} kind="server" />);
    expect(renderedLines(container)[0]).toBe("rpc Watch(In) returns (stream Out);");
    expect(screen.getByRole("button", { name: "Out" })).toBeInTheDocument();
    expect(screen.getByText("stream")).toHaveClass("hs-proto-kw");
  });

  it("omits the rpc line while the kind is unknown but still lists the messages", () => {
    const { container } = render(<ContractView method="Search" input={IN} output={OUT} kind={null} />);
    const lines = renderedLines(container);
    expect(lines.some((l) => l?.startsWith("rpc "))).toBe(false);
    expect(screen.getByText("query")).toBeInTheDocument();
    expect(lines).toContain("message Out {}");
  });

  it("asks to pick a method when none is selected", () => {
    render(<ContractView method="" input={null} output={null} kind="unary" />);
    expect(screen.getByText(messages.contract.pickMethod)).toBeInTheDocument();
  });

  it("shows the unavailable placeholder when both schemas are missing", () => {
    render(<ContractView method="Search" input={null} output={null} kind="unary" />);
    expect(screen.getByText(messages.contract.unavailable)).toBeInTheDocument();
  });

  it("renders the present side and notes the missing one", () => {
    const { container } = render(<ContractView method="Search" input={null} output={OUT} kind="unary" />);
    expect(renderedLines(container)[0]).toBe("rpc Search(?) returns (Out);");
    expect(screen.getByText(messages.contract.schemaUnavailable("input"))).toBeInTheDocument();
  });

  it("notes a missing response side likewise", () => {
    const { container } = render(<ContractView method="Search" input={IN} output={null} kind="unary" />);
    expect(renderedLines(container)[0]).toBe("rpc Search(In) returns (?);");
    expect(screen.getByText(messages.contract.schemaUnavailable("output"))).toBeInTheDocument();
  });
});
