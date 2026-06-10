import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { MessageSchemaIpc, FieldNodeIpc } from "@/ipc/bindings";
import { ContractPanel } from "./ContractPanel";

function f(
  json: string,
  label: string,
  kind: FieldNodeIpc["value_kind"],
  extra: Partial<FieldNodeIpc> = {},
): FieldNodeIpc {
  return {
    json_name: json,
    proto_name: json,
    type_label: label,
    value_kind: kind,
    repeated: false,
    message_type: null,
    enum_type: null,
    oneof_group: null,
    ...extra,
  };
}

const SCHEMA: MessageSchemaIpc = {
  root: "t.Req",
  messages: [{ full_name: "t.Req", fields: [f("query", "string", "scalar")] }],
  enums: [],
};

const OUT: MessageSchemaIpc = {
  root: "t.Resp",
  messages: [{ full_name: "t.Resp", fields: [f("ok", "bool", "scalar")] }],
  enums: [],
};

function renderPanel(
  p: Partial<React.ComponentProps<typeof ContractPanel>> = {},
) {
  const props = {
    open: true,
    onClose: vi.fn(),
    method: "SearchUsers",
    inputSchema: SCHEMA,
    outputSchema: OUT,
    ...p,
  };
  render(
    <TooltipProvider>
      <ContractPanel {...props} />
    </TooltipProvider>,
  );
  return props;
}

describe("ContractPanel", () => {
  it("renders nothing when closed", () => {
    renderPanel({ open: false });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("shows the method name and the Request tree by default", () => {
    renderPanel();
    expect(
      screen.getByRole("dialog", { name: /method contract/i }),
    ).toBeInTheDocument();
    expect(screen.getByText("SearchUsers")).toBeInTheDocument();
    expect(screen.getByText("query")).toBeInTheDocument(); // from inputSchema
  });

  it("switches to the Response tree (visible pre-send)", async () => {
    const user = userEvent.setup();
    renderPanel();
    await user.click(screen.getByRole("tab", { name: /response/i }));
    expect(screen.getByText("ok")).toBeInTheDocument(); // from outputSchema
    expect(screen.queryByText("query")).toBeNull();
  });

  it("shows the unavailable placeholder when the side's schema is null", async () => {
    const user = userEvent.setup();
    renderPanel({ outputSchema: null });
    await user.click(screen.getByRole("tab", { name: /response/i }));
    expect(screen.getByText(/Контракт недоступен/)).toBeInTheDocument();
  });

  it("closes via ✕ and via Escape, but not when Escape was consumed elsewhere", () => {
    const p = renderPanel();
    fireEvent.click(screen.getByRole("button", { name: /close contract/i }));
    expect(p.onClose).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(window, { key: "Escape" });
    expect(p.onClose).toHaveBeenCalledTimes(2);

    const consumed = new KeyboardEvent("keydown", {
      key: "Escape",
      cancelable: true,
    });
    consumed.preventDefault(); // e.g. Monaco closing its suggest widget
    window.dispatchEvent(consumed);
    expect(p.onClose).toHaveBeenCalledTimes(2);
  });
});
