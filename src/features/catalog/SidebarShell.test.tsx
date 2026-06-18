import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { CollectionIpc, ItemIpc } from "@/ipc/bindings";

const tree: { current: ReturnType<typeof makeTreeHook> } = { current: makeTreeHook() };
function makeTreeHook() {
  return {
    tree: [] as CollectionIpc[],
    loading: false,
    reload: vi.fn(),
    createCollection: vi.fn().mockResolvedValue("c-new"),
    deleteCollection: vi.fn(),
    renameCollection: vi.fn(),
    setPinned: vi.fn(),
    setExpanded: vi.fn(),
    addItem: vi.fn(),
    renameItem: vi.fn(),
    deleteItem: vi.fn(),
    duplicateItem: vi.fn(),
  };
}
vi.mock("./CatalogProvider", () => ({ useCatalog: () => tree.current }));
vi.mock("./actions", () => ({ openSavedRequest: vi.fn(), newRequestDraft: vi.fn() }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ save: vi.fn(), open: vi.fn().mockResolvedValue(null) }));
vi.mock("./uiState", () => ({
  loadUiState: vi.fn().mockResolvedValue({ sort_key: null, active_request: null }),
  patchUiState: vi.fn().mockResolvedValue(undefined),
  readUiState: vi.fn().mockReturnValue({ sort_key: null, active_request: null }),
}));

import { SidebarProvider } from "@/components/ui/sidebar";
import { SidebarShell } from "./SidebarShell";
import { newRequestDraft } from "./actions";
import { loadUiState, patchUiState } from "./uiState";

const renderShell = (props = {}) =>
  render(
    <SidebarProvider>
      <SidebarShell {...props} />
    </SidebarProvider>,
  );

function req(id: string, name = id): Extract<ItemIpc, { type: "request" }> {
  return {
    type: "request", id, name, address_template: "h:443", service: "p.v1.S", method: "M",
    body_template: "{}", metadata: [], auth: { kind: "none" }, tls_override: null,
    last_used_at: null, use_count: 0,
  };
}
function col(id: string, name = id, items: ItemIpc[] = []): CollectionIpc {
  return {
    id, name, items, variables: {}, auth: { kind: "none" }, default_tls: false,
    skip_tls_verify: false, pinned: false, description: null, created_at: 0, expanded: true,
  };
}

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  tree.current = makeTreeHook();
});

describe("SidebarShell", () => {
  it("renders the Collections caption as a SidebarGroupLabel", () => {
    renderShell();
    const caption = screen.getByText("Collections");
    expect(caption.closest("[data-sidebar=group-label]")).not.toBeNull();
  });

  it("renders loaded collections", () => {
    tree.current.tree = [col("c1", "Alpha"), col("c2", "Beta")];
    renderShell();
    expect(screen.getByText("Alpha")).toBeTruthy();
    expect(screen.getByText("Beta")).toBeTruthy();
  });

  it("the + menu's New request starts a new request draft", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    renderShell();
    await user.click(screen.getByLabelText("new-item"));
    await user.click(await screen.findByText("New request"));
    expect(newRequestDraft).toHaveBeenCalledTimes(1);
  });

  it("the + menu's New request calls onAddRequest when provided (guarded open)", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    const onAddRequest = vi.fn();
    renderShell({ onAddRequest });
    await user.click(screen.getByLabelText("new-item"));
    await user.click(await screen.findByText("New request"));
    expect(onAddRequest).toHaveBeenCalledTimes(1);
    expect(newRequestDraft).not.toHaveBeenCalled();
  });

  it("the + menu's New collection creates a default-named collection and enters rename", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    renderShell();
    await user.click(screen.getByLabelText("new-item"));
    await user.click(await screen.findByText("New collection"));
    expect(tree.current.createCollection).toHaveBeenCalledWith("New collection");
  });

  it("offers Export and Import in the collections-panel actions menu", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    renderShell();
    await user.click(screen.getByRole("button", { name: /collection actions/i }));
    expect(await screen.findByRole("menuitem", { name: /^export$/i })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: /^import$/i })).toBeInTheDocument();
  });

  it("filters the visible collections by name", () => {
    tree.current.tree = [col("c1", "Payments"), col("c2", "Orders")];
    renderShell();
    fireEvent.change(screen.getByLabelText("collection-filter"), { target: { value: "pay" } });
    expect(screen.getByText("Payments")).toBeTruthy();
    expect(screen.queryByText("Orders")).toBeNull();
  });

  it("restores the persisted sort key on mount", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    vi.mocked(loadUiState).mockResolvedValue({ sort_key: "recent", active_request: null });
    renderShell();
    // Wait for the async load effect to apply the sort, then open the dropdown.
    await user.click(await screen.findByLabelText("sort-collections"));
    const recentItem = (await screen.findByText("Recent")).closest("[data-slot=dropdown-menu-radio-item]");
    expect(recentItem).not.toBeNull();
    expect(recentItem!.getAttribute("data-state")).toBe("checked");
  });

  it("persists the sort key when the user changes it", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    renderShell();
    await user.click(screen.getByLabelText("sort-collections"));
    await user.click(screen.getByText("Created"));
    expect(patchUiState).toHaveBeenCalledWith({ sort_key: "created" });
  });

  it("does not render a settings button (settings live in the titlebar)", () => {
    renderShell();
    expect(screen.queryByLabelText("open-settings")).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("forwards activeItemId to the tree (active row highlighted)", () => {
    tree.current.tree = [col("c1", "Alpha", [req("r9", "Req9")])];
    renderShell({ activeItemId: "r9" });
    const row = screen.getByText("Req9").closest("[data-active]");
    expect(row).not.toBeNull();
    expect(row!.getAttribute("data-active")).toBe("true");
  });

  it("renders collapse all and expand all buttons in the header", () => {
    tree.current.tree = [col("c1", "Alpha")];
    renderShell();
    expect(screen.getByLabelText("collapse all")).toBeTruthy();
    expect(screen.getByLabelText("expand all")).toBeTruthy();
  });

  it("expand all reveals collapsed collections' children", () => {
    tree.current.tree = [{ ...col("c1", "Alpha", [req("r1", "Req1")]), expanded: false }];
    renderShell();
    expect(screen.queryByText("Req1")).toBeNull();
    fireEvent.click(screen.getByLabelText("expand all"));
    expect(screen.getByText("Req1")).toBeTruthy();
  });

  it("collapse all hides expanded collections' children", () => {
    tree.current.tree = [{ ...col("c1", "Alpha", [req("r1", "Req1")]), expanded: true }];
    renderShell();
    expect(screen.getByText("Req1")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("collapse all"));
    expect(screen.queryByText("Req1")).toBeNull();
  });

  it("disables both buttons while a filter is active", () => {
    tree.current.tree = [col("c1", "Alpha")];
    renderShell();
    fireEvent.change(screen.getByLabelText("collection-filter"), { target: { value: "alpha" } });
    expect(screen.getByLabelText("collapse all")).toBeDisabled();
    expect(screen.getByLabelText("expand all")).toBeDisabled();
  });

  it("disables both buttons when there are no collections", () => {
    tree.current.tree = [];
    renderShell();
    expect(screen.getByLabelText("collapse all")).toBeDisabled();
    expect(screen.getByLabelText("expand all")).toBeDisabled();
  });
});
