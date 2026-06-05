import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { CollectionIpc, ItemIpc } from "@/ipc/bindings";
import type { TreeCallbacks } from "./treeTypes";
import { CollectionNode } from "./CollectionNode";

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
    default_tls: false, skip_tls_verify: false, pinned: false, description: null, created_at: 0, ...over,
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
  it("name click opens the collection overview (not toggle)", () => {
    const onOpenCollection = vi.fn();
    const onToggle = vi.fn();
    render(<CollectionNode col={col()} cb={makeCb({ onOpenCollection, onToggle })} />);
    fireEvent.click(screen.getByText("My Collection"));
    expect(onOpenCollection).toHaveBeenCalledWith("c1");
    expect(onToggle).not.toHaveBeenCalled();
  });

  it("chevron click toggles expand", () => {
    const onToggle = vi.fn();
    render(<CollectionNode col={col()} cb={makeCb({ onToggle })} />);
    fireEvent.click(screen.getByLabelText("toggle-collection"));
    expect(onToggle).toHaveBeenCalledWith("c1");
  });

  it("renders children only when open", () => {
    const { rerender } = render(<CollectionNode col={col()} cb={makeCb()} />);
    expect(screen.queryByText("r1")).toBeNull();
    rerender(<CollectionNode col={col()} cb={makeCb({ open: new Set(["c1"]) })} />);
    expect(screen.getByText("r1")).toBeTruthy();
  });

  it("pin button fires onSetPinned with the toggled value", () => {
    const onSetPinned = vi.fn();
    render(<CollectionNode col={col({ pinned: false })} cb={makeCb({ onSetPinned })} />);
    fireEvent.click(screen.getByLabelText("pin-collection"));
    expect(onSetPinned).toHaveBeenCalledWith("c1", true);
  });

  it("menu Delete requests collection deletion", () => {
    const onRequestDeleteCollection = vi.fn();
    render(<CollectionNode col={col()} cb={makeCb({ onRequestDeleteCollection })} />);
    fireEvent.click(screen.getByLabelText("More options"));
    fireEvent.click(screen.getByText("Delete"));
    expect(onRequestDeleteCollection).toHaveBeenCalledWith("c1");
  });

  it("shows an empty hint for a collection with no items when open", () => {
    render(<CollectionNode col={col({ items: [] })} cb={makeCb({ open: new Set(["c1"]) })} />);
    expect(screen.getByText("Empty collection")).toBeTruthy();
  });
});
