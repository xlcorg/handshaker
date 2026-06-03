import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("./actions", () => ({
  describeService: vi.fn(),
  refreshContract: vi.fn(),
  openCallFromMethod: vi.fn(),
}));

import { ServicePanel } from "./ServicePanel";
import { catalogStore } from "./store";
import { describeService, refreshContract } from "./actions";
import type { ServiceCatalogIpc, MethodEntryIpc } from "@/ipc/bindings";

function method(name: string): MethodEntryIpc {
  return {
    name,
    path: `/p.v1.S/${name}`,
    input_message: `${name}Req`,
    output_message: `${name}Res`,
    client_streaming: false,
    server_streaming: false,
  };
}

const contract: ServiceCatalogIpc = {
  services: [{ full_name: "p.v1.S", methods: [method("Get"), method("List")] }],
};

beforeEach(() => {
  vi.clearAllMocks();
  catalogStore.reset();
});

describe("ServicePanel", () => {
  it("with showAll shows ○ methods and curates one into the collection (●)", async () => {
    const user = userEvent.setup();
    const svc = catalogStore.addService({ address: "h:443" });
    catalogStore.setContract(svc.id, contract, 1); // preload → no describe call

    render(<ServicePanel serviceId={svc.id} onClose={() => {}} />);
    await user.click(screen.getByRole("switch", { name: "show-all-contract" }));

    // ○ Get visible; curate it
    await user.click(screen.getByRole("button", { name: "curate-Get" }));
    expect(catalogStore.getService(svc.id)?.curated).toEqual([
      { service: "p.v1.S", method: "Get" },
    ]);
    // now it offers create-call (●)
    expect(screen.getByRole("button", { name: "create-call-Get" })).toBeInTheDocument();
  });

  it("auto-describes the service when its contract is null on open", async () => {
    vi.mocked(describeService).mockResolvedValue(contract);
    const svc = catalogStore.addService({ address: "h:443" });
    // do NOT preload a contract — the effect should fetch it
    render(<ServicePanel serviceId={svc.id} onClose={() => {}} />);
    expect(screen.getByText(/Загрузка контракта/)).toBeInTheDocument();
    await waitFor(() => expect(describeService).toHaveBeenCalledWith(svc));
  });

  it("calls refreshContract from the toolbar button", async () => {
    const user = userEvent.setup();
    vi.mocked(refreshContract).mockResolvedValue(contract);
    const svc = catalogStore.addService({ address: "h:443" });
    catalogStore.setContract(svc.id, contract, 1);
    render(<ServicePanel serviceId={svc.id} onClose={() => {}} />);
    await user.click(screen.getByRole("button", { name: /Обновить контракт/ }));
    expect(refreshContract).toHaveBeenCalled();
  });
});
