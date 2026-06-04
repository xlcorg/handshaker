import { describe, it, expect, vi } from "vitest";
import { makeDragHandlers } from "./dnd";

function fakeEvent() {
  const store: Record<string, string> = {};
  return {
    preventDefault: vi.fn(),
    dataTransfer: {
      effectAllowed: "",
      setData: (k: string, v: string) => {
        store[k] = v;
      },
      getData: (k: string) => store[k] ?? "",
    },
  };
}

describe("makeDragHandlers", () => {
  it("carries the source index from dragStart to drop and calls onReorder(from,to)", () => {
    const onReorder = vi.fn();
    const handlersFor = makeDragHandlers(onReorder);

    const dragEvt = fakeEvent();
    handlersFor(2).onDragStart(dragEvt as never); // dragging row index 2

    const dropEvt = { ...fakeEvent(), dataTransfer: dragEvt.dataTransfer };
    handlersFor(0).onDrop(dropEvt as never); // dropping on row index 0

    expect(onReorder).toHaveBeenCalledWith(2, 0);
    expect(dropEvt.preventDefault).toHaveBeenCalled();
  });

  it("marks each handler-set draggable and prevents default on dragOver", () => {
    const h = makeDragHandlers(vi.fn())(1);
    expect(h.draggable).toBe(true);
    const evt = fakeEvent();
    h.onDragOver(evt as never);
    expect(evt.preventDefault).toHaveBeenCalled();
  });

  it("ignores a drop with no/garbage source index", () => {
    const onReorder = vi.fn();
    const evt = fakeEvent(); // empty dataTransfer → getData returns ""
    makeDragHandlers(onReorder)(0).onDrop(evt as never);
    expect(onReorder).not.toHaveBeenCalled();
  });
});
