import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("./actions", () => ({
  openCallFromMethod: vi.fn(),
}));

import { Sidebar } from "./Sidebar";
import { catalogStore } from "./store";
import { openCallFromMethod } from "./actions";

beforeEach(() => {
  vi.clearAllMocks();
  catalogStore.reset();
});

describe("Sidebar", () => {
  it("shows an empty hint and the ⌘K affordance", () => {
    render(<Sidebar onOpenService={() => {}} onOpenPalette={() => {}} />);
    expect(screen.getByText(/Пусто/)).toBeInTheDocument();
    expect(screen.getByText(/Нет нужного/)).toBeInTheDocument();
  });

  it("expands a service and creates a call when a ● method is clicked", async () => {
    const user = userEvent.setup();
    const svc = catalogStore.addService({ address: "ord:443", label: "Orders", tls: true });
    catalogStore.curateMethod(svc.id, "ord.v1.OrderService", "GetOrder");

    render(<Sidebar onOpenService={() => {}} onOpenPalette={() => {}} />);
    await user.click(screen.getByRole("button", { name: "toggle-service" }));
    await user.click(screen.getByRole("button", { name: /GetOrder/ }));

    expect(openCallFromMethod).toHaveBeenCalledWith(
      expect.objectContaining({ id: svc.id }),
      "ord.v1.OrderService",
      "GetOrder",
      { newWorkflow: false },
    );
  });

  it("opens the service panel via the ⋯ button", async () => {
    const user = userEvent.setup();
    const onOpenService = vi.fn();
    catalogStore.addService({ address: "h:443" });
    render(<Sidebar onOpenService={onOpenService} onOpenPalette={() => {}} />);
    await user.click(screen.getByRole("button", { name: "open-service-panel" }));
    expect(onOpenService).toHaveBeenCalled();
  });
});
