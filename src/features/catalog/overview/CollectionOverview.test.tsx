import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ReactElement } from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { TooltipProvider } from "@/components/ui/tooltip";

vi.mock("@/ipc/client", () => ({
  ipc: {
    collectionUpsert: vi.fn().mockResolvedValue(undefined),
    collectionSetVariables: vi.fn().mockResolvedValue(undefined),
    collectionSetNodeAuth: vi.fn().mockResolvedValue(undefined),
  },
}));

import { ipc } from "@/ipc/client";
import { CollectionOverview } from "./CollectionOverview";
import type { CollectionIpc, ItemIpc } from "@/ipc/bindings";

// CollectionTitle + the close button use the `Tooltip` wrapper, which needs a
// TooltipProvider ancestor (supplied globally in `main.tsx`). Wrap renders here.
function r(ui: ReactElement) {
  return render(<TooltipProvider>{ui}</TooltipProvider>);
}

function req(id: string, name: string): ItemIpc {
  return {
    type: "request", id, name, address_template: "h:443", service: "p.v1.S", method: "GetX",
    body_template: "{}", metadata: [], auth: { kind: "none" }, tls_override: null,
    last_used_at: null, use_count: 0,
  };
}

function collection(over: Partial<CollectionIpc> = {}): CollectionIpc {
  return {
    id: "c1", name: "My Col", items: [req("r1", "GetX")], variables: { base: "x" },
    auth: { kind: "none" }, default_tls: false, skip_tls_verify: false, pinned: false,
    description: null, created_at: 0, ...over,
  };
}

function props(over = {}) {
  return {
    collection: collection(),
    onChanged: vi.fn(),
    onSelectRequest: vi.fn(),
    onClose: vi.fn(),
    ...over,
  };
}

beforeEach(() => vi.clearAllMocks());

describe("CollectionOverview", () => {
  it("renders the Overview tab with the collection name and counts by default", () => {
    r(<CollectionOverview {...props()} />);
    expect(screen.getByText("My Col")).toBeInTheDocument();
    expect(screen.getByText(/1 request/)).toBeInTheDocument();
  });

  it("clicking a request row calls onSelectRequest", () => {
    const p = props();
    r(<CollectionOverview {...p} />);
    fireEvent.click(screen.getByText("GetX"));
    expect(p.onSelectRequest).toHaveBeenCalledWith("c1", expect.objectContaining({ id: "r1" }));
  });

  it("toggling TLS persists via collectionUpsert", () => {
    r(<CollectionOverview {...props()} />);
    fireEvent.click(screen.getAllByRole("switch")[0]);
    expect(ipc.collectionUpsert).toHaveBeenCalledWith(
      expect.objectContaining({ id: "c1", default_tls: true }),
    );
  });

  it("editing the description persists via collectionUpsert", () => {
    r(<CollectionOverview {...props()} />);
    fireEvent.click(screen.getByText(/Add a description/i)); // empty desc → add button
    fireEvent.change(screen.getByPlaceholderText(/Describe what this collection/i), {
      target: { value: "Order APIs" },
    });
    fireEvent.click(screen.getByText("Save"));
    expect(ipc.collectionUpsert).toHaveBeenCalledWith(
      expect.objectContaining({ id: "c1", description: "Order APIs" }),
    );
  });

  it("the Authorization tab persists a chosen auth via collectionSetNodeAuth", () => {
    r(<CollectionOverview {...props()} />);
    fireEvent.click(screen.getByText("Authorization"));
    fireEvent.click(screen.getByText("Bearer"));
    expect(ipc.collectionSetNodeAuth).toHaveBeenCalledWith("c1", null, {
      kind: "env_var", env_var: "", header_name: "authorization", prefix: "Bearer ",
    });
  });

  it("the Variables tab persists edits via collectionSetVariables", () => {
    r(<CollectionOverview {...props()} />);
    fireEvent.click(screen.getByText("Variables"));
    fireEvent.change(screen.getByDisplayValue("x"), { target: { value: "y" } });
    expect(ipc.collectionSetVariables).toHaveBeenCalledWith("c1", { base: "y" });
  });

  it("the close button calls onClose", () => {
    const p = props();
    r(<CollectionOverview {...p} />);
    fireEvent.click(screen.getByLabelText("close-overview"));
    expect(p.onClose).toHaveBeenCalledTimes(1);
  });
});
