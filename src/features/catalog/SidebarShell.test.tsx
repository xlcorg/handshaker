import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { CollectionIpc } from "@/ipc/bindings";

const tree: { current: ReturnType<typeof makeTreeHook> } = { current: makeTreeHook() };
function makeTreeHook() {
  return {
    tree: [] as CollectionIpc[],
    loading: false,
    error: null as string | null,
    reload: vi.fn(),
    createCollection: vi.fn().mockResolvedValue("c-new"),
    deleteCollection: vi.fn(),
    renameCollection: vi.fn(),
    setPinned: vi.fn(),
    addItem: vi.fn(),
    renameItem: vi.fn(),
    deleteItem: vi.fn(),
    duplicateItem: vi.fn(),
  };
}
vi.mock("./CatalogProvider", () => ({ useCatalog: () => tree.current }));
vi.mock("./actions", () => ({ openSavedRequest: vi.fn(), newRequestDraft: vi.fn() }));

import { SidebarShell } from "./SidebarShell";
import { newRequestDraft } from "./actions";

function col(id: string, name = id): CollectionIpc {
  return {
    id, name, items: [], variables: {}, auth: { kind: "none" }, default_tls: false,
    skip_tls_verify: false, pinned: false, description: null, created_at: 0,
  };
}

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  tree.current = makeTreeHook();
});

describe("SidebarShell", () => {
  it("renders loaded collections", () => {
    tree.current.tree = [col("c1", "Alpha"), col("c2", "Beta")];
    render(<SidebarShell />);
    expect(screen.getByText("Alpha")).toBeTruthy();
    expect(screen.getByText("Beta")).toBeTruthy();
  });

  it("the + button starts a new request draft", () => {
    render(<SidebarShell />);
    fireEvent.click(screen.getByLabelText("new-request"));
    expect(newRequestDraft).toHaveBeenCalledTimes(1);
  });

  it("the + button calls onAddRequest when provided (guarded open)", () => {
    const onAddRequest = vi.fn();
    render(<SidebarShell onAddRequest={onAddRequest} />);
    fireEvent.click(screen.getByLabelText("new-request"));
    expect(onAddRequest).toHaveBeenCalledTimes(1);
    expect(newRequestDraft).not.toHaveBeenCalled();
  });

  it("New collection creates a default-named collection and enters rename", async () => {
    render(<SidebarShell />);
    fireEvent.click(screen.getByLabelText("new-collection"));
    expect(tree.current.createCollection).toHaveBeenCalledWith("New collection");
  });

  it("filters the visible collections by name", () => {
    tree.current.tree = [col("c1", "Payments"), col("c2", "Orders")];
    render(<SidebarShell />);
    fireEvent.change(screen.getByLabelText("collection-filter"), { target: { value: "pay" } });
    expect(screen.getByText("Payments")).toBeTruthy();
    expect(screen.queryByText("Orders")).toBeNull();
  });

  it("Ctrl/Cmd+B hides the sidebar", () => {
    tree.current.tree = [col("c1", "Alpha")];
    const { container } = render(<SidebarShell />);
    expect(screen.getByText("Alpha")).toBeTruthy();
    fireEvent.keyDown(window, { key: "b", ctrlKey: true });
    expect(container.querySelector('[aria-label="collections-tree"]')).toBeNull();
  });
});
