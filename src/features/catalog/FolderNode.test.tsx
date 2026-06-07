import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ItemIpc } from "@/ipc/bindings";
import type { TreeCallbacks } from "./treeTypes";
import { FolderNode } from "./FolderNode";
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
const folder: Extract<ItemIpc, { type: "folder" }> = {
  type: "folder", id: "f1", name: "Folder One", items: [req("r1")], expanded: false,
};

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

describe("FolderNode", () => {
  it("hides children when collapsed, shows them when open", () => {
    const { rerender } = renderWithSidebar(
      <FolderNode collectionId="c1" folder={folder} cb={makeCb()} />,
    );
    expect(screen.queryByText("r1")).toBeNull();
    rerender(
      <SidebarProvider>
        <FolderNode collectionId="c1" folder={folder} cb={makeCb({ open: new Set(["f1"]) })} />
      </SidebarProvider>,
    );
    expect(screen.getByText("r1")).toBeTruthy();
  });

  it("open children render inside a [data-sidebar=menu-sub]", () => {
    renderWithSidebar(
      <FolderNode collectionId="c1" folder={folder} cb={makeCb({ open: new Set(["f1"]) })} />,
    );
    const r1Node = screen.getByText("r1");
    const menuSub = r1Node.closest("[data-sidebar='menu-sub']");
    expect(menuSub).toBeTruthy();
  });

  it("open children's data-node-id is a descendant of [data-sidebar=menu-sub]", () => {
    renderWithSidebar(
      <FolderNode collectionId="c1" folder={folder} cb={makeCb({ open: new Set(["f1"]) })} />,
    );
    const r1Row = document.querySelector("[data-node-id='r1']");
    expect(r1Row).toBeTruthy();
    const menuSub = r1Row?.closest("[data-sidebar='menu-sub']");
    expect(menuSub).toBeTruthy();
  });

  it("chevron click toggles", () => {
    const onToggle = vi.fn();
    renderWithSidebar(
      <FolderNode collectionId="c1" folder={folder} cb={makeCb({ onToggle })} />,
    );
    fireEvent.click(screen.getByLabelText("toggle-folder"));
    expect(onToggle).toHaveBeenCalledWith("f1");
  });

  it("name click toggles", () => {
    const onToggle = vi.fn();
    renderWithSidebar(
      <FolderNode collectionId="c1" folder={folder} cb={makeCb({ onToggle })} />,
    );
    fireEvent.click(screen.getByLabelText("expand-folder"));
    expect(onToggle).toHaveBeenCalledWith("f1");
  });

  it("repeat name click toggles", () => {
    const onToggle = vi.fn();
    renderWithSidebar(
      <FolderNode collectionId="c1" folder={folder} cb={makeCb({ onToggle })} />,
    );
    const expandBtn = screen.getByLabelText("expand-folder");
    fireEvent.click(expandBtn);
    fireEvent.click(expandBtn);
    expect(onToggle).toHaveBeenCalledTimes(2);
  });

  it("double-click name triggers rename", () => {
    const onEditingChange = vi.fn();
    renderWithSidebar(
      <FolderNode collectionId="c1" folder={folder} cb={makeCb({ onEditingChange })} />,
    );
    fireEvent.dblClick(screen.getByLabelText("expand-folder"));
    expect(onEditingChange).toHaveBeenCalledWith("f1");
  });

  it("menu offers Add request / Add folder / Rename / Delete", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    const onAddRequest = vi.fn();
    const onAddFolder = vi.fn();
    const onRequestDeleteItem = vi.fn();
    renderWithSidebar(
      <FolderNode
        collectionId="c1"
        folder={folder}
        cb={makeCb({ onAddRequest, onAddFolder, onRequestDeleteItem })}
      />,
    );
    await user.click(screen.getByLabelText("More options"));
    await user.click(screen.getByText("Add request"));
    expect(onAddRequest).toHaveBeenCalledWith("c1", "f1");
    await user.click(screen.getByLabelText("More options"));
    await user.click(screen.getByText("Add folder"));
    expect(onAddFolder).toHaveBeenCalledWith("c1", "f1");
    await user.click(screen.getByLabelText("More options"));
    await user.click(screen.getByText("Delete"));
    expect(onRequestDeleteItem).toHaveBeenCalledWith("c1", "f1");
  });
});
