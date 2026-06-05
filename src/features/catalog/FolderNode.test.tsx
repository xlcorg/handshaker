import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { ItemIpc } from "@/ipc/bindings";
import type { TreeCallbacks } from "./treeTypes";
import { FolderNode } from "./FolderNode";

function req(id: string): Extract<ItemIpc, { type: "request" }> {
  return {
    type: "request", id, name: id, address_template: "h", service: "s", method: "m",
    body_template: "{}", metadata: [], auth: { kind: "none" }, tls_override: null,
    last_used_at: null, use_count: 0,
  };
}
const folder: Extract<ItemIpc, { type: "folder" }> = {
  type: "folder", id: "f1", name: "Folder One", items: [req("r1")],
};

function makeCb(over: Partial<TreeCallbacks> = {}): TreeCallbacks {
  return {
    open: new Set(), activeItemId: null, focusedId: null, editingId: null,
    onToggle: vi.fn(), onEditingChange: vi.fn(), onOpenRequest: vi.fn(),
    onOpenCollection: vi.fn(), onRenameItem: vi.fn(), onRenameCollection: vi.fn(),
    onDuplicateItem: vi.fn(), onRequestDeleteItem: vi.fn(), onRequestDeleteCollection: vi.fn(),
    onAddRequest: vi.fn(), onAddFolder: vi.fn(), onSetPinned: vi.fn(), ...over,
  };
}

describe("FolderNode", () => {
  it("hides children when collapsed, shows them when open", () => {
    const { rerender } = render(<FolderNode collectionId="c1" folder={folder} depth={1} cb={makeCb()} />);
    expect(screen.queryByText("r1")).toBeNull();
    rerender(<FolderNode collectionId="c1" folder={folder} depth={1} cb={makeCb({ open: new Set(["f1"]) })} />);
    expect(screen.getByText("r1")).toBeTruthy();
  });

  it("toggles on name click", () => {
    const onToggle = vi.fn();
    render(<FolderNode collectionId="c1" folder={folder} depth={1} cb={makeCb({ onToggle })} />);
    fireEvent.click(screen.getByText("Folder One"));
    expect(onToggle).toHaveBeenCalledWith("f1");
  });

  it("menu offers Add request / Add folder / Rename / Delete", () => {
    const onAddRequest = vi.fn();
    const onAddFolder = vi.fn();
    const onRequestDeleteItem = vi.fn();
    render(<FolderNode collectionId="c1" folder={folder} depth={1} cb={makeCb({ onAddRequest, onAddFolder, onRequestDeleteItem })} />);
    fireEvent.click(screen.getByLabelText("More options"));
    fireEvent.click(screen.getByText("Add request"));
    expect(onAddRequest).toHaveBeenCalledWith("c1", "f1");
    fireEvent.click(screen.getByLabelText("More options"));
    fireEvent.click(screen.getByText("Add folder"));
    expect(onAddFolder).toHaveBeenCalledWith("c1", "f1");
    fireEvent.click(screen.getByLabelText("More options"));
    fireEvent.click(screen.getByText("Delete"));
    expect(onRequestDeleteItem).toHaveBeenCalledWith("c1", "f1");
  });
});
