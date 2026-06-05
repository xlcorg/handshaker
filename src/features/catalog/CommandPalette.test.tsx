import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { CollectionIpc, ItemIpc, SavedRequestIpc } from "@/ipc/bindings";
import { CommandPalette } from "./CommandPalette";

function req(id: string, name: string, over: Partial<SavedRequestIpc> = {}): ItemIpc {
  return {
    type: "request", id, name, address_template: "h:443", service: "p.v1.S", method: "GetX",
    body_template: "{}", metadata: [], auth: { kind: "none" }, tls_override: null,
    last_used_at: null, use_count: 0, ...over,
  };
}
function col(id: string, name: string, items: ItemIpc[]): CollectionIpc {
  return {
    id, name, items, variables: {}, auth: { kind: "none" }, default_tls: false,
    skip_tls_verify: false, pinned: false, description: null, created_at: 0,
  };
}

const collections = [
  col("c1", "Orders", [req("r1", "Alpha")]),
  col("c2", "Inventory", [req("r2", "Beta")]),
];

beforeEach(() => vi.clearAllMocks());

describe("CommandPalette", () => {
  it("renders nothing when closed", () => {
    const { container } = render(
      <CommandPalette open={false} onClose={() => {}} collections={collections} onOpen={() => {}} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("lists saved requests from every collection with their location", () => {
    render(<CommandPalette open onClose={() => {}} collections={collections} onOpen={() => {}} />);
    expect(screen.getByText("Alpha")).toBeInTheDocument();
    expect(screen.getByText("Beta")).toBeInTheDocument();
    expect(screen.getByText("Orders")).toBeInTheDocument(); // collection name as location
  });

  it("filters by query", async () => {
    const user = userEvent.setup();
    render(<CommandPalette open onClose={() => {}} collections={collections} onOpen={() => {}} />);
    await user.type(screen.getByLabelText("command-input"), "beta");
    expect(screen.getByText("Beta")).toBeInTheDocument();
    expect(screen.queryByText("Alpha")).not.toBeInTheDocument();
  });

  it("Enter opens the active request and closes", async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    const onClose = vi.fn();
    render(<CommandPalette open onClose={onClose} collections={collections} onOpen={onOpen} />);
    const input = screen.getByLabelText("command-input");
    input.focus();
    await user.keyboard("{Enter}"); // empty query → first by name = "Alpha" (c1)
    expect(onOpen).toHaveBeenCalledWith("c1", expect.objectContaining({ id: "r1", name: "Alpha" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("clicking a row opens that request", async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    render(<CommandPalette open onClose={() => {}} collections={collections} onOpen={onOpen} />);
    await user.click(screen.getByText("Beta"));
    expect(onOpen).toHaveBeenCalledWith("c2", expect.objectContaining({ id: "r2" }));
  });

  it("Escape closes", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<CommandPalette open onClose={onClose} collections={collections} onOpen={() => {}} />);
    const input = screen.getByLabelText("command-input");
    input.focus();
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("shows an empty state when nothing matches", async () => {
    const user = userEvent.setup();
    render(<CommandPalette open onClose={() => {}} collections={collections} onOpen={() => {}} />);
    await user.type(screen.getByLabelText("command-input"), "zzzznomatch");
    expect(screen.getByText(/No saved requests/i)).toBeInTheDocument();
  });
});
