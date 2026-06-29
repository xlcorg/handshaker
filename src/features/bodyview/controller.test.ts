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
      event: { ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, detail: 1, browserEvent: { preventDefault: vi.fn() }, ...ev },
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

  it("selects the value on a plain double-click", () => {
    const text = `{"name":"hello world"}`;
    const parsed = parseWithSpans(text)!;
    const onSelectValue = vi.fn();
    const { editor, fire } = fakeEditor(text);
    attachBodyController(editor, { getTree: () => parsed.tree, getSpans: () => parsed.spans, onSelectValue });
    fire(text.indexOf("hello"), { detail: 2 });
    expect(onSelectValue).toHaveBeenCalledTimes(1);
    const range = onSelectValue.mock.calls[0][0];
    expect(text.slice(range.start, range.end)).toBe("hello world");
  });

  it("does not select a value on Shift or Alt double-click", () => {
    const text = `{"name":"hello world"}`;
    const parsed = parseWithSpans(text)!;
    const onSelectValue = vi.fn();
    const { editor, fire } = fakeEditor(text);
    attachBodyController(editor, { getTree: () => parsed.tree, getSpans: () => parsed.spans, onSelectValue });
    fire(text.indexOf("hello"), { detail: 2, shiftKey: true });
    fire(text.indexOf("hello"), { detail: 2, altKey: true });
    expect(onSelectValue).not.toHaveBeenCalled();
  });

  it("does not fire onSelectValue on Ctrl+double-click (that path copies)", () => {
    const text = `{"name":"hello world"}`;
    const parsed = parseWithSpans(text)!;
    const onSelectValue = vi.fn();
    const { editor, fire } = fakeEditor(text);
    attachBodyController(editor, { getTree: () => parsed.tree, getSpans: () => parsed.spans, onSelectValue });
    fire(text.indexOf("hello"), { detail: 2, ctrlKey: true });
    expect(onSelectValue).not.toHaveBeenCalled();
  });

  it("does not select on a double-click that lands on a key", () => {
    const text = `{"name":"Ada"}`;
    const parsed = parseWithSpans(text)!;
    const onSelectValue = vi.fn();
    const { editor, fire } = fakeEditor(text);
    attachBodyController(editor, { getTree: () => parsed.tree, getSpans: () => parsed.spans, onSelectValue });
    fire(text.indexOf("name"), { detail: 2 });
    expect(onSelectValue).not.toHaveBeenCalled();
  });
});
