import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("./actions", () => ({
  describeService: vi.fn(),
  openCallFromMethod: vi.fn(),
}));

import { CommandPalette } from "./CommandPalette";
import { catalogStore } from "./store";
import { describeService, openCallFromMethod } from "./actions";
import type { ServiceCatalogIpc, MethodEntryIpc } from "@/ipc/bindings";

function method(name: string): MethodEntryIpc {
  return {
    name,
    path: `/ord.v1.S/${name}`,
    input_message: `${name}Req`,
    output_message: `${name}Res`,
    client_streaming: false,
    server_streaming: false,
  };
}

const contract: ServiceCatalogIpc = {
  services: [{ full_name: "ord.v1.OrderService", methods: [method("GetOrder")] }],
};

beforeEach(() => {
  vi.clearAllMocks();
  catalogStore.reset();
  vi.mocked(describeService).mockResolvedValue(contract);
});

describe("CommandPalette", () => {
  it("renders nothing when closed", () => {
    const { container } = render(<CommandPalette open={false} onClose={() => {}} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("stage 1: fuzzy-filters services by query", async () => {
    const user = userEvent.setup();
    catalogStore.addService({ address: "pay:443", label: "payment-api" });
    catalogStore.addService({ address: "inv:443", label: "inventory" });
    render(<CommandPalette open onClose={() => {}} />);
    await user.type(screen.getByLabelText("command-input"), "pay");
    expect(screen.getByText("payment-api")).toBeInTheDocument();
    expect(screen.queryByText("inventory")).not.toBeInTheDocument();
  });

  it("Enter picks a service, loads its contract, then Enter creates a call", async () => {
    const user = userEvent.setup();
    const svc = catalogStore.addService({ address: "ord:443", label: "Orders" });
    // preload contract so stage 2 lists the method without async timing
    catalogStore.setContract(svc.id, contract, 1);

    render(<CommandPalette open onClose={() => {}} />);
    const input = screen.getByLabelText("command-input");
    input.focus();
    await user.keyboard("{Enter}"); // pick first (only) service
    expect(await screen.findByText("GetOrder")).toBeInTheDocument();
    input.focus();
    await user.keyboard("{Enter}"); // pick first method

    expect(openCallFromMethod).toHaveBeenCalledWith(
      expect.objectContaining({ id: svc.id }),
      "ord.v1.OrderService",
      "GetOrder",
      { newWorkflow: false },
    );
  });

  it("Escape from stage 2 returns to service stage", async () => {
    const user = userEvent.setup();
    const svc = catalogStore.addService({ address: "ord:443", label: "Orders" });
    catalogStore.setContract(svc.id, contract, 1);
    render(<CommandPalette open onClose={() => {}} />);
    const input = screen.getByLabelText("command-input");
    input.focus();
    await user.keyboard("{Enter}"); // → stage method
    expect(await screen.findByText("GetOrder")).toBeInTheDocument();
    input.focus();
    await user.keyboard("{Escape}"); // → back to service
    expect(screen.getByPlaceholderText("Поиск сервиса…")).toBeInTheDocument();
  });
});
