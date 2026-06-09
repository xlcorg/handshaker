import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { CollectionIpc, ItemIpc } from "@/ipc/bindings";
import type { TreeCallbacks } from "./treeTypes";
import { CollectionNode } from "./CollectionNode";
import { SidebarProvider } from "@/components/ui/sidebar";

function renderWithSidebar(ui: React.ReactElement) {
  return render(<SidebarProvider>{ui}</SidebarProvider>);
}

function req(id: string): Extract<ItemIpc, { type: "request" }> {
  return {
    type: "request", id, name: id, address_template: "h", service: "s", method: "m",
    body_template: "{}", metadata: [], auth: { kind: "none" }, tls_override: null,
    last_used_at: null, use_count: 0,
  };
}
function col(over: Partial<CollectionIpc> = {}): CollectionIpc {
  return {
    id: "c1", name: "My Collection", items: [req("r1")], variables: {}, auth: { kind: "none" },
    default_tls: false, skip_tls_verify: false, pinned: false, description: null, created_at: 0, expanded: false, ...over,
  };
}
function makeCb(over: Partial<TreeCallbacks> = {}): TreeCallbacks {
  return {
    open: new Set(), activeItemId: null, focusedId: null, editingId: null,
    onToggle: vi.fn(), onEditingChange: vi.fn(), onOpenRequest: vi.fn(),
    onOpenCollection: vi.fn(), onRenameItem: vi.fn(), onRenameCollection: vi.fn(),
    onDuplicateItem: vi.fn(), onRequestDeleteItem: vi.fn(), onRequestDeleteCollection: vi.fn(),
    onAddRequest: vi.fn(), onAddFolder: vi.fn(), onSetPinned: vi.fn(),
    dragId: null, dropHint: null, onDragStartItem: vi.fn(), onDragOverRow: vi.fn(),
    onDropRow: vi.fn(), onDragEndItem: vi.fn(), ...over,
  };
}

describe("CollectionNode", () => {
  it("name click opens the collection overview AND toggles", () => {
    const onOpenCollection = vi.fn();
    const onToggle = vi.fn();
    renderWithSidebar(<CollectionNode col={col()} cb={makeCb({ onOpenCollection, onToggle })} />);
    fireEvent.click(screen.getByText("My Collection"));
    expect(onOpenCollection).toHaveBeenCalledWith("c1");
    expect(onToggle).toHaveBeenCalledWith("c1");
  });

  it("repeat name click toggles (collapses)", () => {
    const onToggle = vi.fn();
    renderWithSidebar(<CollectionNode col={col()} cb={makeCb({ onToggle })} />);
    const nameBtn = screen.getByLabelText("open-collection");
    fireEvent.click(nameBtn);
    fireEvent.click(nameBtn);
    expect(onToggle).toHaveBeenCalledTimes(2);
  });

  it("chevron click toggles expand", () => {
    const onToggle = vi.fn();
    renderWithSidebar(<CollectionNode col={col()} cb={makeCb({ onToggle })} />);
    fireEvent.click(screen.getByLabelText("toggle-collection"));
    expect(onToggle).toHaveBeenCalledWith("c1");
  });

  it("renders children only when open", () => {
    const { rerender } = renderWithSidebar(<CollectionNode col={col()} cb={makeCb()} />);
    expect(screen.queryByText("r1")).toBeNull();
    rerender(
      <SidebarProvider>
        <CollectionNode col={col()} cb={makeCb({ open: new Set(["c1"]) })} />
      </SidebarProvider>,
    );
    expect(screen.getByText("r1")).toBeTruthy();
    // r1 row should be inside [data-sidebar="menu-sub"]
    const r1Node = screen.getByText("r1");
    const menuSub = r1Node.closest("[data-sidebar='menu-sub']");
    expect(menuSub).toBeTruthy();
  });

  it("pin button fires onSetPinned with the toggled value", () => {
    const onSetPinned = vi.fn();
    renderWithSidebar(<CollectionNode col={col({ pinned: false })} cb={makeCb({ onSetPinned })} />);
    fireEvent.click(screen.getByLabelText("pin-collection"));
    expect(onSetPinned).toHaveBeenCalledWith("c1", true);
  });

  it("menu Delete requests collection deletion", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    const onRequestDeleteCollection = vi.fn();
    renderWithSidebar(<CollectionNode col={col()} cb={makeCb({ onRequestDeleteCollection })} />);
    await user.click(screen.getByLabelText("More options"));
    await user.click(screen.getByText("Delete"));
    expect(onRequestDeleteCollection).toHaveBeenCalledWith("c1");
  });

  it("shows an empty hint for a collection with no items when open", () => {
    renderWithSidebar(<CollectionNode col={col({ items: [] })} cb={makeCb({ open: new Set(["c1"]) })} />);
    expect(screen.getByText("Empty collection")).toBeTruthy();
  });

  it("fills the collection row with a tint when dropHint zone is 'inside'", () => {
    renderWithSidebar(<CollectionNode col={col()} cb={makeCb({ dropHint: { id: "c1", zone: "inside" } })} />);
    const row = document.querySelector("[data-node-id='c1']") as HTMLElement;
    expect(row.className).toContain("bg-primary/10");
  });

  it("does not fill the row when not the drop target", () => {
    renderWithSidebar(<CollectionNode col={col()} cb={makeCb({ dropHint: { id: "other", zone: "inside" } })} />);
    const row = document.querySelector("[data-node-id='c1']") as HTMLElement;
    expect(row.className).not.toContain("bg-primary/10");
  });

  it("dropping anywhere in the open collection body targets the collection inside", () => {
    const onDragOverRow = vi.fn();
    const onDropRow = vi.fn();
    renderWithSidebar(
      <CollectionNode
        col={col({ items: [] })}
        cb={makeCb({ open: new Set(["c1"]), onDragOverRow, onDropRow })}
      />,
    );
    const placeholder = screen.getByText("Empty collection");
    fireEvent.dragOver(placeholder);
    expect(onDragOverRow).toHaveBeenCalledWith({ collectionId: "c1", id: "c1", kind: "collection" }, "inside");
    fireEvent.drop(placeholder);
    expect(onDropRow).toHaveBeenCalledWith({ collectionId: "c1", id: "c1", kind: "collection" }, "inside");
  });

  it("dragging over a child row is not overridden by the collection body fallback", () => {
    const onDragOverRow = vi.fn();
    renderWithSidebar(<CollectionNode col={col()} cb={makeCb({ open: new Set(["c1"]), onDragOverRow })} />);
    const childRow = document.querySelector("[data-node-id='r1']")!;
    fireEvent.dragOver(childRow);
    expect(onDragOverRow).not.toHaveBeenCalledWith(
      { collectionId: "c1", id: "c1", kind: "collection" },
      "inside",
    );
    expect(onDragOverRow).toHaveBeenCalled();
  });
});
