import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ContractView } from "./ContractView";
import type { MessageSchemaIpc } from "@/ipc/bindings";

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

describe("ContractView", () => {
  it("renders the selected side's schema and reports the switch state", () => {
    const onSide = vi.fn();
    render(<ContractView method="Search" input={IN} output={OUT} side="request" onSide={onSide} />);
    expect(screen.getByText("query")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Request" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Response" })).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(screen.getByRole("button", { name: "Response" }));
    expect(onSide).toHaveBeenCalledWith("response");
  });

  it("renders the response side when selected, and the method name", () => {
    render(<ContractView method="Search" input={IN} output={OUT} side="response" onSide={vi.fn()} />);
    expect(screen.getByText(/Out/)).toBeInTheDocument();
    expect(screen.queryByText("query")).toBeNull();
    expect(screen.getByText("Search")).toBeInTheDocument();
  });

  it("asks to pick a method when none is selected", () => {
    render(<ContractView method="" input={null} output={null} side="request" onSide={vi.fn()} />);
    expect(screen.getByText(/Выбери метод/)).toBeInTheDocument();
  });

  it("shows the unavailable placeholder when the schema is missing", () => {
    render(<ContractView method="Search" input={null} output={OUT} side="request" onSide={vi.fn()} />);
    expect(screen.getByText(/Контракт недоступен/)).toBeInTheDocument();
  });
});
