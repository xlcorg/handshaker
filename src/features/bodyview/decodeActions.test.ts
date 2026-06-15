import { describe, it, expect, vi } from "vitest";
import { parseWithSpans } from "./parse";
import { attachDecodeActions, type DecodeEditorLike } from "./decodeActions";

// Minimal fake editor: single-line, offset = column - 1 (mirrors controller.test).
// The gate is now computed on a right-button mousedown (before Monaco builds its menu).
function fakeEditor() {
  const runs: Record<string, (ed: DecodeEditorLike) => void> = {};
  let ctxValue = false;
  let mouseListener:
    | ((e: { event: { rightButton: boolean }; target: { position: { lineNumber: number; column: number } | null } }) => void)
    | null = null;
  let disposeCount = 0;
  const mkDisp = () => ({ dispose: () => { disposeCount += 1; } });
  const editor: DecodeEditorLike = {
    getModel: () => ({
      getOffsetAt: (pos) => pos.column - 1,
      getPositionAt: (off) => ({ lineNumber: 1, column: off + 1 }),
      setValue: () => {},
      getValueInRange: () => "",
    }),
    createContextKey: <T,>(_k: string, def: T) => { ctxValue = def as unknown as boolean; return { set: (v: boolean) => { ctxValue = v; } }; },
    addAction: (a) => { runs[a.id] = a.run; return mkDisp(); },
    onMouseDown: (cb) => { mouseListener = cb; return mkDisp(); },
  };
  return {
    editor,
    run: (id: string) => runs[id]?.(editor),
    actionIds: () => Object.keys(runs),
    rightClickAt: (offset: number) => mouseListener?.({ event: { rightButton: true }, target: { position: { lineNumber: 1, column: offset + 1 } } }),
    leftClickAt: (offset: number) => mouseListener?.({ event: { rightButton: false }, target: { position: { lineNumber: 1, column: offset + 1 } } }),
    ctx: () => ctxValue,
    disposeCount: () => disposeCount,
  };
}

describe("attachDecodeActions", () => {
  const text = `{"k":"aGVsbG8="}`; // value "aGVsbG8=" is valid base64
  const p = parseWithSpans(text)!;
  const off = text.indexOf("aGV");

  function deps(extra?: Partial<Parameters<typeof attachDecodeActions>[1]>) {
    return {
      getTree: () => p.tree,
      getSpans: () => p.spans,
      onDecode: vi.fn(),
      onCopy: vi.fn(),
      onSave: vi.fn(),
      ...extra,
    };
  }

  it("registers the three actions", () => {
    const f = fakeEditor();
    attachDecodeActions(f.editor, deps());
    expect(f.actionIds()).toEqual(
      expect.arrayContaining(["hs.decodeBase64", "hs.copyValue", "hs.saveDecoded"]),
    );
  });

  it("Decode/Copy/Save run with the right-clicked value", () => {
    const f = fakeEditor();
    const d = deps();
    attachDecodeActions(f.editor, d);
    f.rightClickAt(off); // populates the clicked value + gate before the menu would build
    f.run("hs.decodeBase64");
    f.run("hs.copyValue");
    f.run("hs.saveDecoded");
    expect(d.onDecode).toHaveBeenCalledWith("aGVsbG8=");
    expect(d.onCopy).toHaveBeenCalledWith("aGVsbG8=");
    expect(d.onSave).toHaveBeenCalledWith("aGVsbG8=");
  });

  it("sets the gate key true over a base64 value, false elsewhere", () => {
    const f = fakeEditor();
    attachDecodeActions(f.editor, deps());
    f.rightClickAt(off);
    expect(f.ctx()).toBe(true);
    f.rightClickAt(text.indexOf('"k"')); // the key, not a string-value span
    expect(f.ctx()).toBe(false);
  });

  it("sets the gate key false over a non-base64 string", () => {
    const t2 = `{"k":"hi"}`; // "hi" is < 4 chars
    const p2 = parseWithSpans(t2)!;
    const f = fakeEditor();
    attachDecodeActions(f.editor, { getTree: () => p2.tree, getSpans: () => p2.spans, onDecode: vi.fn(), onCopy: vi.fn(), onSave: vi.fn() });
    f.rightClickAt(t2.indexOf("hi"));
    expect(f.ctx()).toBe(false);
  });

  it("ignores a non-right-button mousedown for gating", () => {
    const f = fakeEditor();
    attachDecodeActions(f.editor, deps());
    f.leftClickAt(off);
    expect(f.ctx()).toBe(false);
  });

  it("disposes every registration", () => {
    const f = fakeEditor();
    const handle = attachDecodeActions(f.editor, deps());
    handle.dispose();
    expect(f.disposeCount()).toBe(4); // 3 actions + 1 mousedown listener
  });
});
