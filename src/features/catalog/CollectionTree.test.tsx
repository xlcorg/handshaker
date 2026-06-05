import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { CollectionIpc, ItemIpc } from "@/ipc/bindings";
import { CollectionTree, type CollectionTreeProps } from "./CollectionTree";

function req(id: string): Extract<ItemIpc, { type: "request" }> {
  return {
    type: "request", id, name: id, address_template: "h", service: "s", method: "m",
    body_template: "{}", metadata: [], auth: { kind: "none" }, tls_override: null,
    last_used_at: null, use_count: 0,
  };
}
function col(id: string, items: ItemIpc[]): CollectionIpc {
  return {
    id, name: id, items, variables: {}, auth: { kind: "none" }, default_tls: false,
    skip_tls_verify: false, pinned: false, description: null, created_at: 0,
  };
}

function setup(over: Partial<CollectionTreeProps> = {}) {
  const props: CollectionTreeProps = {
    collections: [col("c1", [req("r1")]), col("c2", [])],
    filterActive: false,
    activeItemId: null,
    editingId: null,
    onEditingChange: vi.fn(),
    onOpenRequest: vi.fn(),
    onOpenCollection: vi.fn(),
    onRenameItem: vi.fn(),
    onRenameCollection: vi.fn(),
    onDuplicateItem: vi.fn(),
    onDeleteItem: vi.fn(),
    onDeleteCollection: vi.fn(),
    onAddRequest: vi.fn(),
    onAddFolder: vi.fn(),
    onSetPinned: vi.fn(),
    ...over,
  };
  render(<CollectionTree {...props} />);
  return props;
}

describe("CollectionTree arrow navigation", () => {
  it("ArrowDown moves focus through visible nodes; ArrowRight expands a collection", () => {
    setup();
    const tree = screen.getByLabelText("collections-tree");
    fireEvent.keyDown(tree, { key: "ArrowDown" }); // focus c1
    fireEvent.keyDown(tree, { key: "ArrowRight" }); // expand c1
    expect(screen.getByText("r1")).toBeTruthy();
  });

  it("Enter on a focused request opens it", () => {
    const props = setup();
    const tree = screen.getByLabelText("collections-tree");
    fireEvent.keyDown(tree, { key: "ArrowDown" }); // c1
    fireEvent.keyDown(tree, { key: "ArrowRight" }); // expand
    fireEvent.keyDown(tree, { key: "ArrowDown" }); // r1
    fireEvent.keyDown(tree, { key: "Enter" });
    expect(props.onOpenRequest).toHaveBeenCalledWith("c1", expect.objectContaining({ id: "r1" }));
  });

  it("F2 on a focused node requests rename via onEditingChange", () => {
    const props = setup();
    const tree = screen.getByLabelText("collections-tree");
    fireEvent.keyDown(tree, { key: "ArrowDown" }); // c1
    fireEvent.keyDown(tree, { key: "F2" });
    expect(props.onEditingChange).toHaveBeenCalledWith("c1");
  });

  it("hiding the focused child drops its focus; ArrowDown then re-focuses the first node", () => {
    const onEditingChange = vi.fn();
    const base: CollectionTreeProps = {
      collections: [col("c1", [req("r1")])],
      filterActive: true, // expands all, so r1 is a visible (focusable) row
      activeItemId: null,
      editingId: null,
      onEditingChange,
      onOpenRequest: vi.fn(),
      onOpenCollection: vi.fn(),
      onRenameItem: vi.fn(),
      onRenameCollection: vi.fn(),
      onDuplicateItem: vi.fn(),
      onDeleteItem: vi.fn(),
      onDeleteCollection: vi.fn(),
      onAddRequest: vi.fn(),
      onAddFolder: vi.fn(),
      onSetPinned: vi.fn(),
    };
    const { rerender } = render(<CollectionTree {...base} />);
    const tree = screen.getByLabelText("collections-tree");
    fireEvent.keyDown(tree, { key: "ArrowDown" }); // focus c1
    fireEvent.keyDown(tree, { key: "ArrowDown" }); // focus r1

    // SidebarShell now passes a filtered list where r1 is gone: the focused node
    // is no longer visible, so the effect must clear focus on the SAME instance.
    rerender(<CollectionTree {...base} collections={[col("c1", [])]} />);

    // Focus cleared -> ArrowDown lands on the first node (c1), not a stale index.
    fireEvent.keyDown(tree, { key: "ArrowDown" });
    fireEvent.keyDown(tree, { key: "F2" });
    expect(onEditingChange).toHaveBeenLastCalledWith("c1");
  });
});

describe("CollectionTree filter", () => {
  it("treats everything as expanded when filtering", () => {
    setup({ filterActive: true });
    expect(screen.getByText("r1")).toBeTruthy();
  });
});

describe("CollectionTree confirm-delete", () => {
  it("request-delete from a row menu opens the confirm dialog, and confirming calls onDeleteItem", () => {
    const props = setup({ collections: [col("c1", [req("r1")])] });
    const tree = screen.getByLabelText("collections-tree");
    fireEvent.keyDown(tree, { key: "ArrowDown" });
    fireEvent.keyDown(tree, { key: "ArrowRight" });
    const moreButtons = screen.getAllByLabelText("More options");
    fireEvent.click(moreButtons[moreButtons.length - 1]);
    fireEvent.click(screen.getByText("Delete"));
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(props.onDeleteItem).toHaveBeenCalledWith("c1", "r1");
  });
});
