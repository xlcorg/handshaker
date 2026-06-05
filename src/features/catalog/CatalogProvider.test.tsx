import { describe, it, expect, vi } from "vitest";
import { render, screen, act, waitFor } from "@testing-library/react";
import type { ItemIpc } from "@/ipc/bindings";

vi.mock("@/ipc/client", () => ({
  ipc: {
    collectionList: vi.fn().mockResolvedValue([{ id: "c1", name: "C1" }]),
    collectionGet: vi.fn().mockResolvedValue({
      id: "c1", name: "C1", items: [], variables: {}, auth: { kind: "none" },
      default_tls: false, skip_tls_verify: false, pinned: false, description: null, created_at: 0,
    }),
    collectionAddItem: vi.fn().mockResolvedValue(undefined),
    collectionUpsert: vi.fn().mockResolvedValue(undefined),
  },
}));

import { CatalogProvider, useCatalog } from "./CatalogProvider";

const req: ItemIpc = {
  type: "request", id: "req-1", name: "GetX", address_template: "h:443",
  service: "p.S", method: "GetX", body_template: "{}", metadata: [],
  auth: { kind: "none" }, tls_override: null, last_used_at: null, use_count: 0,
};

let addViaA: ((c: string, p: string | null, i: ItemIpc) => Promise<void>) | null = null;
function ConsumerA() {
  const cat = useCatalog();
  addViaA = cat.addItem;
  return <div data-testid="a">{cat.tree[0]?.items.length ?? -1}</div>;
}
function ConsumerB() {
  const cat = useCatalog();
  return <div data-testid="b">{cat.tree[0]?.items.length ?? -1}</div>;
}

describe("CatalogProvider shared instance", () => {
  it("a mutation through one consumer is visible to another (the save-visibility bug)", async () => {
    render(
      <CatalogProvider>
        <ConsumerA />
        <ConsumerB />
      </CatalogProvider>,
    );
    // initial load: collection c1 with 0 items, seen by BOTH consumers
    await waitFor(() => expect(screen.getByTestId("a")).toHaveTextContent("0"));
    expect(screen.getByTestId("b")).toHaveTextContent("0");

    await act(async () => {
      await addViaA!("c1", null, req);
    });

    // BOTH consumers now reflect the added request — not just the one that saved
    expect(screen.getByTestId("a")).toHaveTextContent("1");
    expect(screen.getByTestId("b")).toHaveTextContent("1");
  });

  it("throws when used outside the provider", () => {
    function Bare() {
      useCatalog();
      return null;
    }
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(<Bare />)).toThrow(/useCatalog must be used within/);
    spy.mockRestore();
  });
});
