import { describe, it, expect, vi, beforeEach } from "vitest";
import { attachBodyController } from "./controller";
import { parseWithSpans } from "./parse";
import type { EditorLike, EditorMouseEventLike, ModelLike } from "./editorLike";

// --- minimal fake editor over a fixed text -------------------------------
function fakeEditor(text: string) {
  let handler: ((e: EditorMouseEventLike) => void) | null = null;
  const model: ModelLike = {
    getOffsetAt: (pos) => pos.column - 1,           // single-line: column(1-based) -> offset
    getPositionAt: (off) => ({ lineNumber: 1, column: off + 1 }),
    setValue: vi.fn(),
    getValueInRange: (range) => text.slice(range.startColumn - 1, range.endColumn - 1),
  };
  const dispose = vi.fn();
  const editor: EditorLike = {
    getModel: () => model,
    onMouseDown: (cb) => { handler = cb; return { dispose }; },
  };
  const fire = (offset: number, over: Partial<EditorMouseEventLike["event"]> & { element?: HTMLElement | null }) => {
    const { element = null, ...ev } = over;
    handler?.({
      event: { ctrlKey: false, metaKey: false, detail: 1, browserEvent: { preventDefault: vi.fn() }, ...ev },
      target: { element, position: { lineNumber: 1, column: offset + 1 } },
    });
  };
  return { editor, fire, dispose };
}

beforeEach(() => {
  vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue(undefined);
});

describe("attachBodyController", () => {
  it("copies the value on Ctrl+double-click", () => {
    const text = `{"name":"Ada"}`;
    const parsed = parseWithSpans(text)!;
    const { editor, fire } = fakeEditor(text);
    attachBodyController(editor, {
      getTree: () => parsed.tree,
      getSpans: () => parsed.spans,
      onBadgeExpand: vi.fn(),
    });
    fire(text.indexOf("Ada"), { ctrlKey: true, detail: 2 });
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith("Ada");
  });

  it("ignores a plain double-click (no modifier)", () => {
    const text = `{"name":"Ada"}`;
    const parsed = parseWithSpans(text)!;
    const { editor, fire } = fakeEditor(text);
    attachBodyController(editor, { getTree: () => parsed.tree, getSpans: () => parsed.spans, onBadgeExpand: vi.fn() });
    fire(text.indexOf("Ada"), { detail: 2 });
    expect(navigator.clipboard.writeText).not.toHaveBeenCalled();
  });

  it("calls onBadgeExpand when a badge element is clicked", () => {
    const text = `{"name":"Ada"}`;
    const parsed = parseWithSpans(text)!;
    const onBadgeExpand = vi.fn();
    const { editor, fire } = fakeEditor(text);
    const badgeEl = document.createElement("span");
    badgeEl.className = "bodyview-badge";
    attachBodyController(editor, {
      getTree: () => parsed.tree,
      getSpans: () => parsed.spans,
      getBadgeNodeIdAt: () => "n1",
      onBadgeExpand,
    });
    fire(5, { detail: 1, element: badgeEl });
    expect(onBadgeExpand).toHaveBeenCalledWith("n1");
  });

  it("returns a disposable that tears down the mouse-down subscription", () => {
    const text = `{"name":"Ada"}`;
    const parsed = parseWithSpans(text)!;
    const { editor, dispose } = fakeEditor(text);
    const handle = attachBodyController(editor, { getTree: () => parsed.tree, getSpans: () => parsed.spans });
    handle.dispose();
    expect(dispose).toHaveBeenCalledTimes(1);
  });
});
