import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ItemIpc } from "@/ipc/bindings";
import type { TreeCallbacks } from "./treeTypes";
import { RequestRow } from "./RequestRow";
import { SidebarProvider } from "@/components/ui/sidebar";

function req(name: string): Extract<ItemIpc, { type: "request" }> {
  return {
    type: "request",
    id: "r1",
    name,
    address_template: "h:443",
    service: "p.v1.S",
    method: "GetX",
    body_template: "{}",
    metadata: [],
    auth: { kind: "none" },
    tls_override: null,
    last_used_at: null,
    use_count: 0,
  };
}

function makeCb(over: Partial<TreeCallbacks> = {}): TreeCallbacks {
  return {
    open: new Set(),
    activeItemId: null,
    activeCollectionId: null,
    focusedId: null,
    editingId: null,
    onToggle: vi.fn(),
    onEditingChange: vi.fn(),
    onOpenRequest: vi.fn(),
    onOpenCollection: vi.fn(),
    onRenameItem: vi.fn(),
    onRenameCollection: vi.fn(),
    onDuplicateItem: vi.fn(),
    onRequestDeleteItem: vi.fn(),
    onRequestDeleteCollection: vi.fn(),
    onExportCollection: vi.fn(),
    onAddRequest: vi.fn(),
    onAddFolder: vi.fn(),
    onSetPinned: vi.fn(),
    dragId: null,
    dropHint: null,
    onDragStartItem: vi.fn(),
    onDragOverRow: vi.fn(),
    onDropRow: vi.fn(),
    onDragEndItem: vi.fn(),
    ...over,
  };
}

function renderWithSidebar(ui: React.ReactElement) {
  return render(<SidebarProvider>{ui}</SidebarProvider>);
}

describe("RequestRow", () => {
  it("renders the gRPC icon (default solid)", () => {
    renderWithSidebar(
      <RequestRow collectionId="c1" req={req("My Req")} cb={makeCb()} />,
    );
    const icon = screen.getByLabelText("grpc");
    expect(icon.getAttribute("data-variant")).toBe("solid");
  });

  it("shows the name and opens the request on click", () => {
    const onOpenRequest = vi.fn();
    const cb = makeCb({ onOpenRequest });
    renderWithSidebar(
      <RequestRow collectionId="c1" req={req("My Req")} cb={cb} />,
    );
    fireEvent.click(screen.getByText("My Req"));
    expect(onOpenRequest).toHaveBeenCalledWith(
      "c1",
      expect.objectContaining({ id: "r1" }),
    );
  });

  it("falls back to the method name when unnamed", () => {
    renderWithSidebar(
      <RequestRow collectionId="c1" req={req("")} cb={makeCb()} />,
    );
    expect(screen.getByText("GetX")).toBeTruthy();
  });

  it("double-click enters rename (onEditingChange with the item id)", () => {
    const onEditingChange = vi.fn();
    renderWithSidebar(
      <RequestRow
        collectionId="c1"
        req={req("R")}
        cb={makeCb({ onEditingChange })}
      />,
    );
    fireEvent.doubleClick(screen.getByText("R"));
    expect(onEditingChange).toHaveBeenCalledWith("r1");
  });

  it("renders the rename input when editingId matches and commits a rename", () => {
    const onRenameItem = vi.fn();
    const onEditingChange = vi.fn();
    const cb = makeCb({ editingId: "r1", onRenameItem, onEditingChange });
    renderWithSidebar(
      <RequestRow collectionId="c1" req={req("Old")} cb={cb} />,
    );
    const input = screen.getByLabelText("rename-input");
    fireEvent.change(input, { target: { value: "New" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onEditingChange).toHaveBeenCalledWith(null);
    expect(onRenameItem).toHaveBeenCalledWith("c1", "r1", "New");
  });

  it("menu Delete requests deletion via onRequestDeleteItem", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    const onRequestDeleteItem = vi.fn();
    renderWithSidebar(
      <RequestRow
        collectionId="c1"
        req={req("R")}
        cb={makeCb({ onRequestDeleteItem })}
      />,
    );
    await user.click(screen.getByLabelText("More options"));
    await user.click(screen.getByText("Delete"));
    expect(onRequestDeleteItem).toHaveBeenCalledWith("c1", "r1");
  });

  it("active row carries data-active=true", () => {
    renderWithSidebar(
      <RequestRow
        collectionId="c1"
        req={req("A")}
        cb={makeCb({ activeItemId: "r1" })}
      />,
    );
    const node = document.querySelector('[data-node-id="r1"]');
    expect(node).not.toBeNull();
    expect(node!.getAttribute("data-active")).toBe("true");
  });

  it("non-active row does not carry data-active=true", () => {
    renderWithSidebar(
      <RequestRow
        collectionId="c1"
        req={req("A")}
        cb={makeCb({ activeItemId: null })}
      />,
    );
    const node = document.querySelector('[data-node-id="r1"]');
    expect(node).not.toBeNull();
    expect(node!.getAttribute("data-active")).not.toBe("true");
  });

  it("row has data-slot=sidebar-menu-sub-button", () => {
    renderWithSidebar(
      <RequestRow collectionId="c1" req={req("B")} cb={makeCb()} />,
    );
    const node = document.querySelector('[data-node-id="r1"]');
    expect(node).not.toBeNull();
    expect(node!.getAttribute("data-slot")).toBe("sidebar-menu-sub-button");
  });

  it("exposes depth-scaled bleed offsets for the full-width highlight", () => {
    const { rerender } = renderWithSidebar(
      <RequestRow collectionId="c1" req={req("B")} depth={1} cb={makeCb()} />,
    );
    const at = () =>
      document.querySelector('[data-node-id="r1"]') as HTMLElement;
    // depth 1 → 3 - 18 = -15px / 1 - 15 = -14px
    expect(at().style.getPropertyValue("--bl")).toBe("-15px");
    expect(at().style.getPropertyValue("--br")).toBe("-14px");

    // Deeper rows break out further so the highlight still reaches the sidebar edges.
    rerender(
      <SidebarProvider>
        <RequestRow collectionId="c1" req={req("B")} depth={2} cb={makeCb()} />
      </SidebarProvider>,
    );
    expect(at().style.getPropertyValue("--bl")).toBe("-33px");
    expect(at().style.getPropertyValue("--br")).toBe("-29px");
  });

  it("renders a drop line before the row when dropHint zone is 'before'", () => {
    renderWithSidebar(
      <RequestRow
        collectionId="c1"
        req={req("R")}
        cb={makeCb({ dropHint: { id: "r1", zone: "before" } })}
      />,
    );
    expect(document.querySelector("[data-drop-line='before']")).not.toBeNull();
  });

  it("renders a drop line after the row when dropHint zone is 'after'", () => {
    renderWithSidebar(
      <RequestRow
        collectionId="c1"
        req={req("R")}
        cb={makeCb({ dropHint: { id: "r1", zone: "after" } })}
      />,
    );
    expect(document.querySelector("[data-drop-line='after']")).not.toBeNull();
  });

  it("renders no drop line when dropHint is null", () => {
    renderWithSidebar(
      <RequestRow collectionId="c1" req={req("R")} cb={makeCb()} />,
    );
    expect(document.querySelector("[data-drop-line]")).toBeNull();
  });

  it("renders no drop line when dropHint targets another row", () => {
    renderWithSidebar(
      <RequestRow
        collectionId="c1"
        req={req("R")}
        cb={makeCb({ dropHint: { id: "other", zone: "before" } })}
      />,
    );
    expect(document.querySelector("[data-drop-line]")).toBeNull();
  });
});
