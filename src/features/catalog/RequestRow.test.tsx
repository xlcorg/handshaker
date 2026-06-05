import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { ItemIpc } from "@/ipc/bindings";
import type { TreeCallbacks } from "./treeTypes";
import { RequestRow } from "./RequestRow";

function req(name: string): Extract<ItemIpc, { type: "request" }> {
  return {
    type: "request", id: "r1", name, address_template: "h:443", service: "p.v1.S",
    method: "GetX", body_template: "{}", metadata: [], auth: { kind: "none" },
    tls_override: null, last_used_at: null, use_count: 0,
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

describe("RequestRow", () => {
  it("shows the name and opens the request on click", () => {
    const onOpenRequest = vi.fn();
    const cb = makeCb({ onOpenRequest });
    render(<RequestRow collectionId="c1" req={req("My Req")} depth={1} cb={cb} />);
    fireEvent.click(screen.getByText("My Req"));
    expect(onOpenRequest).toHaveBeenCalledWith("c1", expect.objectContaining({ id: "r1" }));
  });

  it("falls back to the method name when unnamed", () => {
    render(<RequestRow collectionId="c1" req={req("")} depth={1} cb={makeCb()} />);
    expect(screen.getByText("GetX")).toBeTruthy();
  });

  it("double-click enters rename (onEditingChange with the item id)", () => {
    const onEditingChange = vi.fn();
    render(<RequestRow collectionId="c1" req={req("R")} depth={1} cb={makeCb({ onEditingChange })} />);
    fireEvent.doubleClick(screen.getByText("R"));
    expect(onEditingChange).toHaveBeenCalledWith("r1");
  });

  it("renders the rename input when editingId matches and commits a rename", () => {
    const onRenameItem = vi.fn();
    const onEditingChange = vi.fn();
    const cb = makeCb({ editingId: "r1", onRenameItem, onEditingChange });
    render(<RequestRow collectionId="c1" req={req("Old")} depth={1} cb={cb} />);
    const input = screen.getByLabelText("rename-input");
    fireEvent.change(input, { target: { value: "New" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onEditingChange).toHaveBeenCalledWith(null);
    expect(onRenameItem).toHaveBeenCalledWith("c1", "r1", "New");
  });

  it("menu Delete requests deletion via onRequestDeleteItem", () => {
    const onRequestDeleteItem = vi.fn();
    render(<RequestRow collectionId="c1" req={req("R")} depth={1} cb={makeCb({ onRequestDeleteItem })} />);
    fireEvent.click(screen.getByLabelText("More options"));
    fireEvent.click(screen.getByText("Delete"));
    expect(onRequestDeleteItem).toHaveBeenCalledWith("c1", "r1");
  });
});
