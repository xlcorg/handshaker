import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { CollectionPicker, type PickTarget } from "./CollectionPicker";
import type { CollectionIpc, ItemIpc } from "@/ipc/bindings";

function folder(id: string, name: string, items: ItemIpc[] = []): ItemIpc {
  return { type: "folder", id, name, items };
}
function col(id: string, name: string, items: ItemIpc[] = []): CollectionIpc {
  return {
    id, name, items, variables: {}, auth: { kind: "none" },
    default_tls: false, skip_tls_verify: false, pinned: false, description: null, created_at: 0,
  };
}

const tree = [
  col("c1", "My APIs", [folder("f1", "Staging"), folder("f2", "Prod")]),
  col("c2", "Sandbox"),
];

function setup(over: Partial<React.ComponentProps<typeof CollectionPicker>> = {}) {
  const onChange = vi.fn();
  const value: PickTarget = { collectionId: "c1", parentId: null };
  render(
    <CollectionPicker collections={tree} query="" value={value} onChange={onChange} {...over} />,
  );
  return { onChange };
}

describe("CollectionPicker", () => {
  it("renders top-level collections", () => {
    setup();
    expect(screen.getByText("My APIs")).toBeTruthy();
    expect(screen.getByText("Sandbox")).toBeTruthy();
  });

  it("selecting a collection emits {collectionId, parentId:null}", () => {
    const { onChange } = setup();
    fireEvent.click(screen.getByText("Sandbox"));
    expect(onChange).toHaveBeenCalledWith({ collectionId: "c2", parentId: null });
  });

  it("expanding a collection reveals its folders, and selecting one emits parentId=folderId", () => {
    const { onChange } = setup();
    // Auto-reveal: My APIs is auto-expanded because c1 is selected; folders are visible immediately.
    fireEvent.click(screen.getByText("Staging"));
    expect(onChange).toHaveBeenCalledWith({ collectionId: "c1", parentId: "f1" });
  });

  it("with a query, filters to matching nodes and shows them expanded", () => {
    setup({ query: "prod" });
    expect(screen.getByText("Prod")).toBeTruthy();
    expect(screen.queryByText("Sandbox")).toBeNull();
  });

  it("marks the selected node", () => {
    setup();
    expect(screen.getByText("My APIs").closest("[data-selected='true']")).toBeTruthy();
  });

  it("marks a selected folder", () => {
    const onChange = vi.fn();
    render(
      <CollectionPicker collections={tree} query="" value={{ collectionId: "c1", parentId: "f1" }} onChange={onChange} />,
    );
    // Auto-reveal: My APIs is auto-expanded because f1 is selected, so Staging is already visible.
    expect(screen.getByText("Staging").closest("[data-selected='true']")).toBeTruthy();
  });

  it("collapsing an expanded collection hides its folders", () => {
    setup(); // value=c1 → "My APIs" auto-expanded, folders visible
    expect(screen.getByText("Staging")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("collapse My APIs"));
    expect(screen.queryByText("Staging")).toBeNull();
    expect(screen.queryByText("Prod")).toBeNull();
  });
});
