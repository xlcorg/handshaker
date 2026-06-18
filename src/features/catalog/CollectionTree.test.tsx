import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, createEvent, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRef } from "react";
import type { CollectionIpc, ItemIpc } from "@/ipc/bindings";
import { CollectionTree, type CollectionTreeProps, type CollectionTreeHandle } from "./CollectionTree";
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
function col(id: string, items: ItemIpc[]): CollectionIpc {
  return {
    id, name: id, items, variables: {}, auth: { kind: "none" }, default_tls: false,
    skip_tls_verify: false, pinned: false, description: null, created_at: 0, expanded: false,
  };
}

function makeProps(over: Partial<CollectionTreeProps> = {}): CollectionTreeProps {
  return {
    collections: [col("c1", [req("r1")]), col("c2", [])],
    filterActive: false,
    activeItemId: null,
    activeCollectionId: null,
    editingId: null,
    onEditingChange: vi.fn(),
    onOpenRequest: vi.fn(),
    onOpenCollection: vi.fn(),
    onRenameItem: vi.fn(),
    onRenameCollection: vi.fn(),
    onDuplicateItem: vi.fn(),
    onDeleteItem: vi.fn(),
    onDeleteCollection: vi.fn(),
    onExportCollection: vi.fn(),
    onAddRequest: vi.fn(),
    onAddFolder: vi.fn(),
    onSetPinned: vi.fn(),
    onMoveItem: vi.fn(),
    onMoveItemAcross: vi.fn(),
    onSetExpanded: vi.fn(),
    ...over,
  };
}

function setup(over: Partial<CollectionTreeProps> = {}) {
  const props = makeProps(over);
  renderWithSidebar(<CollectionTree {...props} />);
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
      activeCollectionId: null,
      editingId: null,
      onEditingChange,
      onOpenRequest: vi.fn(),
      onOpenCollection: vi.fn(),
      onRenameItem: vi.fn(),
      onRenameCollection: vi.fn(),
      onDuplicateItem: vi.fn(),
      onDeleteItem: vi.fn(),
      onDeleteCollection: vi.fn(),
      onExportCollection: vi.fn(),
      onAddRequest: vi.fn(),
      onAddFolder: vi.fn(),
      onSetPinned: vi.fn(),
      onMoveItem: vi.fn(),
      onMoveItemAcross: vi.fn(),
      onSetExpanded: vi.fn(),
    };
    const { rerender } = renderWithSidebar(<CollectionTree {...base} />);
    const tree = screen.getByLabelText("collections-tree");
    fireEvent.keyDown(tree, { key: "ArrowDown" }); // focus c1
    fireEvent.keyDown(tree, { key: "ArrowDown" }); // focus r1

    // SidebarShell now passes a filtered list where r1 is gone: the focused node
    // is no longer visible, so the effect must clear focus on the SAME instance.
    rerender(
      <SidebarProvider>
        <CollectionTree {...base} collections={[col("c1", [])]} />
      </SidebarProvider>,
    );

    // Focus cleared -> ArrowDown lands on the first node (c1), not a stale index.
    fireEvent.keyDown(tree, { key: "ArrowDown" });
    fireEvent.keyDown(tree, { key: "F2" });
    expect(onEditingChange).toHaveBeenLastCalledWith("c1");
  });
});

describe("CollectionTree scroll container", () => {
  it("renders the tree inside a ScrollArea viewport", () => {
    setup();
    const tree = screen.getByLabelText("collections-tree");
    expect(tree.getAttribute("role")).toBe("tree");
    expect(tree.closest("[data-slot='scroll-area-viewport']")).toBeTruthy();
  });
});

describe("CollectionTree filter", () => {
  it("treats everything as expanded when filtering", () => {
    setup({ filterActive: true });
    expect(screen.getByText("r1")).toBeTruthy();
  });
});

describe("CollectionTree active-row highlight", () => {
  it("marks the active request row with data-active", () => {
    setup({ collections: [col("c1", [req("r1"), req("r2")])], filterActive: true, activeItemId: "r1" });
    const r1 = document.querySelector('[data-node-id="r1"]');
    const r2 = document.querySelector('[data-node-id="r2"]');
    expect(r1?.getAttribute("data-active")).toBe("true");
    expect(r2?.getAttribute("data-active")).not.toBe("true");
  });
});

describe("CollectionTree confirm-delete", () => {
  it("request-delete from a row menu opens the confirm dialog, and confirming calls onDeleteItem", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    const props = setup({ collections: [col("c1", [req("r1")])] });
    const tree = screen.getByLabelText("collections-tree");
    fireEvent.keyDown(tree, { key: "ArrowDown" });
    fireEvent.keyDown(tree, { key: "ArrowRight" });
    const moreButtons = screen.getAllByLabelText("More options");
    await user.click(moreButtons[moreButtons.length - 1]);
    await user.click(await screen.findByText("Delete")); // menu item
    fireEvent.click(await screen.findByRole("button", { name: "Delete" })); // confirm dialog
    expect(props.onDeleteItem).toHaveBeenCalledWith("c1", "r1");
  });
});

function folder(id: string, items: ItemIpc[] = []): Extract<ItemIpc, { type: "folder" }> {
  return { type: "folder", id, name: id, items, expanded: false };
}

function renderTree(collections: CollectionIpc[]) {
  const onMoveItem = vi.fn();
  const onMoveItemAcross = vi.fn();
  setup({ collections, filterActive: true, onMoveItem, onMoveItemAcross });
  return { onMoveItem, onMoveItemAcross };
}

const rowOf = (id: string) => document.querySelector(`[data-node-id="${id}"]`) as HTMLElement;

// jsdom's DragEvent ignores `clientY` from the init dict, so define it explicitly
// on the event before dispatch (otherwise zoneFromPointer sees NaN).
function dragOverAt(el: HTMLElement, clientY: number) {
  const ev = createEvent.dragOver(el);
  Object.defineProperty(ev, "clientY", { value: clientY });
  fireEvent(el, ev);
}
function dropAt(el: HTMLElement, clientY: number) {
  const ev = createEvent.drop(el);
  Object.defineProperty(ev, "clientY", { value: clientY });
  fireEvent(el, ev);
}

describe("CollectionTree drag-and-drop", () => {
  let rectSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    rectSpy = vi
      .spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockReturnValue({ top: 0, height: 100, bottom: 100, left: 0, right: 0, width: 0, x: 0, y: 0, toJSON: () => ({}) } as DOMRect);
  });
  afterEach(() => rectSpy.mockRestore());

  it("reorders a request after a sibling (same collection)", () => {
    const { onMoveItem } = renderTree([col("c1", [folder("f1"), req("r3"), req("r4")])]);
    fireEvent.dragStart(rowOf("r3"));
    dropAt(rowOf("r4"), 90);
    expect(onMoveItem).toHaveBeenCalledWith("c1", "r3", null, 2);
  });

  it("drops a request into a folder", () => {
    const { onMoveItem } = renderTree([col("c1", [folder("f1"), req("r3")])]);
    fireEvent.dragStart(rowOf("r3"));
    dropAt(rowOf("f1"), 50);
    expect(onMoveItem).toHaveBeenCalledWith("c1", "r3", "f1", 0);
  });

  it("moves a request across collections via the collection header", () => {
    const { onMoveItemAcross } = renderTree([col("c1", [req("r3")]), col("c2", [])]);
    fireEvent.dragStart(rowOf("r3"));
    dropAt(rowOf("c2"), 5);
    expect(onMoveItemAcross).toHaveBeenCalledWith("c1", "r3", "c2", null, 0);
  });

  it("sets data-drop on the hovered row during dragover", () => {
    renderTree([col("c1", [req("r3"), req("r4")])]);
    fireEvent.dragStart(rowOf("r3"));
    dragOverAt(rowOf("r4"), 10);
    expect(rowOf("r4").getAttribute("data-drop")).toBe("before");
  });
});

describe("CollectionTree drag auto-expand", () => {
  function efolder(id: string, items: ItemIpc[], expanded: boolean): Extract<ItemIpc, { type: "folder" }> {
    return { type: "folder", id, name: id, items, expanded };
  }
  function ecol(id: string, items: ItemIpc[], expanded: boolean): CollectionIpc {
    return {
      id, name: id, items, variables: {}, auth: { kind: "none" }, default_tls: false,
      skip_tls_verify: false, pinned: false, description: null, created_at: 0, expanded,
    };
  }

  let rectSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    vi.useFakeTimers();
    rectSpy = vi
      .spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockReturnValue({ top: 0, height: 100, bottom: 100, left: 0, right: 0, width: 0, x: 0, y: 0, toJSON: () => ({}) } as DOMRect);
  });
  afterEach(() => {
    rectSpy.mockRestore();
    vi.useRealTimers();
  });

  it("hovering a collapsed folder during drag for 700ms expands it (and persists)", () => {
    // c1 expanded so f1 row renders; f1 collapsed with child rIn; rDrag draggable at root.
    const onSetExpanded = vi.fn();
    setup({
      collections: [ecol("c1", [efolder("f1", [req("rIn")], false), req("rDrag")], true)],
      filterActive: false,
      onSetExpanded,
    });
    fireEvent.dragStart(rowOf("rDrag"));
    dragOverAt(rowOf("f1"), 50);
    act(() => vi.advanceTimersByTime(700));
    expect(screen.getByText("rIn")).toBeTruthy();
    expect(onSetExpanded).toHaveBeenCalledWith("c1", "f1", true);
  });

  it("leaving the target early cancels", () => {
    const onSetExpanded = vi.fn();
    setup({
      collections: [ecol("c1", [efolder("f1", [req("rIn")], false), req("rDrag")], true)],
      filterActive: false,
      onSetExpanded,
    });
    fireEvent.dragStart(rowOf("rDrag"));
    dragOverAt(rowOf("f1"), 50);
    act(() => vi.advanceTimersByTime(300));
    dragOverAt(rowOf("rDrag"), 50); // move to a different (sibling) row
    act(() => vi.advanceTimersByTime(400));
    expect(screen.queryByText("rIn")).toBeNull();
    expect(onSetExpanded).not.toHaveBeenCalledWith("c1", "f1", true);
  });

  it("dropping clears the pending timer", () => {
    const onSetExpanded = vi.fn();
    setup({
      collections: [ecol("c1", [efolder("f1", [req("rIn")], false), req("rDrag")], true)],
      filterActive: false,
      onSetExpanded,
    });
    fireEvent.dragStart(rowOf("rDrag"));
    dragOverAt(rowOf("f1"), 50);
    act(() => vi.advanceTimersByTime(300));
    dropAt(rowOf("f1"), 50);
    act(() => vi.advanceTimersByTime(700));
    expect(screen.queryByText("rIn")).toBeNull();
    expect(onSetExpanded).not.toHaveBeenCalledWith("c1", "f1", true);
  });

  it("dragEnd cancels the pending auto-expand timer", () => {
    const onSetExpanded = vi.fn();
    setup({
      collections: [ecol("c1", [efolder("f1", [req("rIn")], false), req("rDrag")], true)],
      filterActive: false,
      onSetExpanded,
    });
    fireEvent.dragStart(rowOf("rDrag"));
    dragOverAt(rowOf("f1"), 50);
    act(() => vi.advanceTimersByTime(300));
    fireEvent.dragEnd(rowOf("rDrag"));
    act(() => vi.advanceTimersByTime(400)); // 700ms total elapsed, but timer should be cleared
    expect(screen.queryByText("rIn")).toBeNull();
    expect(onSetExpanded).not.toHaveBeenCalledWith("c1", "f1", true);
  });
});

describe("CollectionTree persisted expansion", () => {
  function efolder(id: string, items: ItemIpc[], expanded: boolean): Extract<ItemIpc, { type: "folder" }> {
    return { type: "folder", id, name: id, items, expanded };
  }
  function ecol(id: string, items: ItemIpc[], expanded: boolean): CollectionIpc {
    return {
      id, name: id, items, variables: {}, auth: { kind: "none" }, default_tls: false,
      skip_tls_verify: false, pinned: false, description: null, created_at: 0, expanded,
    };
  }

  it("seeds open-state from persisted expanded flags", () => {
    setup({
      collections: [ecol("c1", [efolder("f1", [req("r1")], true)], true)],
      filterActive: false,
    });
    expect(screen.getByText("r1")).toBeTruthy();
  });

  it("toggling a folder persists via onSetExpanded(collectionId, folderId, newState)", () => {
    const onSetExpanded = vi.fn();
    setup({
      collections: [ecol("c1", [efolder("f1", [req("r1")], false)], true)],
      filterActive: false,
      onSetExpanded,
    });
    fireEvent.click(screen.getByLabelText("toggle-folder"));
    expect(onSetExpanded).toHaveBeenCalledWith("c1", "f1", true);
  });

  it("toggling a collection persists with null itemId", () => {
    const onSetExpanded = vi.fn();
    setup({
      collections: [col("c1", [req("r1")])],
      filterActive: false,
      onSetExpanded,
    });
    fireEvent.click(screen.getByLabelText("toggle-collection"));
    expect(onSetExpanded).toHaveBeenCalledWith("c1", null, true);
  });

  it("ArrowRight on a focused collection persists expand via onSetExpanded", () => {
    const onSetExpanded = vi.fn();
    setup({
      collections: [col("c1", [req("r1")])],
      filterActive: false,
      onSetExpanded,
    });
    const tree = screen.getByLabelText("collections-tree");
    fireEvent.keyDown(tree, { key: "ArrowDown" }); // focus c1
    fireEvent.keyDown(tree, { key: "ArrowRight" }); // expand c1
    expect(onSetExpanded).toHaveBeenCalledWith("c1", null, true);
  });

  it("ArrowLeft on a focused open collection persists collapse via onSetExpanded", () => {
    const onSetExpanded = vi.fn();
    setup({
      collections: [ecol("c1", [req("r1")], true)],
      filterActive: false,
      onSetExpanded,
    });
    const tree = screen.getByLabelText("collections-tree");
    fireEvent.keyDown(tree, { key: "ArrowDown" }); // focus c1
    fireEvent.keyDown(tree, { key: "ArrowLeft" }); // collapse c1
    expect(onSetExpanded).toHaveBeenCalledWith("c1", null, false);
  });

  it("ArrowRight on a focused folder persists expand via onSetExpanded", () => {
    const onSetExpanded = vi.fn();
    setup({
      collections: [ecol("c1", [efolder("f1", [req("r1")], false)], true)],
      filterActive: false,
      onSetExpanded,
    });
    const tree = screen.getByLabelText("collections-tree");
    fireEvent.keyDown(tree, { key: "ArrowDown" }); // focus c1
    fireEvent.keyDown(tree, { key: "ArrowDown" }); // focus f1 (c1 is expanded)
    fireEvent.keyDown(tree, { key: "ArrowRight" }); // expand f1
    expect(onSetExpanded).toHaveBeenCalledWith("c1", "f1", true);
  });
});

describe("CollectionTree expand/collapse all handle", () => {
  function efolder(id: string, items: ItemIpc[], expanded: boolean): Extract<ItemIpc, { type: "folder" }> {
    return { type: "folder", id, name: id, items, expanded };
  }

  it("expandAll() opens every collection and persists each with null itemId", () => {
    const props = makeProps({ collections: [col("c1", [req("r1")]), col("c2", [req("r2")])] });
    const ref = createRef<CollectionTreeHandle>();
    renderWithSidebar(<CollectionTree {...props} ref={ref} />);

    // Both collections start collapsed -> children hidden.
    expect(screen.queryByText("r1")).toBeNull();
    expect(screen.queryByText("r2")).toBeNull();

    act(() => ref.current!.expandAll());

    expect(screen.getByText("r1")).toBeTruthy();
    expect(screen.getByText("r2")).toBeTruthy();
    expect(props.onSetExpanded).toHaveBeenCalledWith("c1", null, true);
    expect(props.onSetExpanded).toHaveBeenCalledWith("c2", null, true);
  });

  it("collapseAll() closes every collection and persists each with null itemId", () => {
    // Both collections start expanded (children visible).
    const c1 = { ...col("c1", [req("r1")]), expanded: true };
    const c2 = { ...col("c2", [req("r2")]), expanded: true };
    const props = makeProps({ collections: [c1, c2] });
    const ref = createRef<CollectionTreeHandle>();
    renderWithSidebar(<CollectionTree {...props} ref={ref} />);

    expect(screen.getByText("r1")).toBeTruthy();

    act(() => ref.current!.collapseAll());

    expect(screen.queryByText("r1")).toBeNull();
    expect(screen.queryByText("r2")).toBeNull();
    expect(props.onSetExpanded).toHaveBeenCalledWith("c1", null, false);
    expect(props.onSetExpanded).toHaveBeenCalledWith("c2", null, false);
  });

  it("expandAll() targets collection ids only, never folder ids (top-level scope)", () => {
    // c1 holds a collapsed folder f1; expandAll must not persist f1.
    const props = makeProps({ collections: [{ ...col("c1", [efolder("f1", [req("rIn")], false)]), expanded: false }] });
    const ref = createRef<CollectionTreeHandle>();
    renderWithSidebar(<CollectionTree {...props} ref={ref} />);

    act(() => ref.current!.expandAll());

    expect(props.onSetExpanded).toHaveBeenCalledWith("c1", null, true);
    expect(props.onSetExpanded).not.toHaveBeenCalledWith("c1", "f1", true);
    // f1's own folded state is untouched: rIn stays hidden.
    expect(screen.queryByText("rIn")).toBeNull();
  });
});
