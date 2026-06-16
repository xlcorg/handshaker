import { describe, it, expect, vi } from "vitest";
import { parseWithSpans } from "./parse";
import { attachDecodeActions, type DecodeEditorLike } from "./decodeActions";

// Minimal fake editor: single-line, offset = column - 1 (mirrors controller.test).
// The gates are now computed on a right-button mousedown (before Monaco builds its
// menu); context keys are tracked by name so we can assert each independently.
function fakeEditor() {
  const runs: Record<string, (ed: DecodeEditorLike) => void> = {};
  const keys: Record<string, boolean> = {};
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
    createContextKey: <T,>(k: string, def: T) => {
      keys[k] = def as unknown as boolean;
      return { set: (v: boolean) => { keys[k] = v; } };
    },
    addAction: (a) => { runs[a.id] = a.run; return mkDisp(); },
    onMouseDown: (cb) => { mouseListener = cb; return mkDisp(); },
  };
  return {
    editor,
    run: (id: string) => runs[id]?.(editor),
    actionIds: () => Object.keys(runs),
    rightClickAt: (offset: number) => mouseListener?.({ event: { rightButton: true }, target: { position: { lineNumber: 1, column: offset + 1 } } }),
    leftClickAt: (offset: number) => mouseListener?.({ event: { rightButton: false }, target: { position: { lineNumber: 1, column: offset + 1 } } }),
    key: (k: string) => keys[k],
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
      onCopyDecoded: vi.fn(),
      onCopyValue: vi.fn(),
      onSaveDecoded: vi.fn(),
      onSaveBase64: vi.fn(),
      ...extra,
    };
  }

  it("registers the four actions", () => {
    const f = fakeEditor();
    attachDecodeActions(f.editor, deps());
    expect(f.actionIds()).toEqual(
      expect.arrayContaining([
        "hs.copyDecodedBase64",
        "hs.copyValue",
        "hs.saveDecodedBase64",
        "hs.saveBase64",
      ]),
    );
  });

  it("each action runs with the right-clicked value", () => {
    const f = fakeEditor();
    const d = deps();
    attachDecodeActions(f.editor, d);
    f.rightClickAt(off); // populates the clicked value + gates before the menu would build
    f.run("hs.copyDecodedBase64");
    f.run("hs.copyValue");
    f.run("hs.saveDecodedBase64");
    f.run("hs.saveBase64");
    expect(d.onCopyDecoded).toHaveBeenCalledWith("aGVsbG8=");
    expect(d.onCopyValue).toHaveBeenCalledWith("aGVsbG8=");
    expect(d.onSaveDecoded).toHaveBeenCalledWith("aGVsbG8=");
    expect(d.onSaveBase64).toHaveBeenCalledWith("aGVsbG8=");
  });

  it("gates the base64 actions on a base64 value, off elsewhere", () => {
    const f = fakeEditor();
    attachDecodeActions(f.editor, deps());
    f.rightClickAt(off);
    expect(f.key("hsValueIsB64")).toBe(true);
    expect(f.key("hsValueIsString")).toBe(true);
    f.rightClickAt(text.indexOf('"k"')); // the key, not a string-value span
    expect(f.key("hsValueIsB64")).toBe(false);
    expect(f.key("hsValueIsString")).toBe(false);
  });

  it("over a non-base64 string: Copy value gate on, base64 gate off", () => {
    const t2 = `{"k":"hello world"}`; // a string, but not base64 (space)
    const p2 = parseWithSpans(t2)!;
    const f = fakeEditor();
    attachDecodeActions(f.editor, { ...deps(), getTree: () => p2.tree, getSpans: () => p2.spans });
    f.rightClickAt(t2.indexOf("hello"));
    expect(f.key("hsValueIsString")).toBe(true);
    expect(f.key("hsValueIsB64")).toBe(false);
  });

  it("ignores a non-right-button mousedown for gating", () => {
    const f = fakeEditor();
    attachDecodeActions(f.editor, deps());
    f.leftClickAt(off);
    expect(f.key("hsValueIsB64")).toBe(false);
    expect(f.key("hsValueIsString")).toBe(false);
  });

  it("disposes every registration", () => {
    const f = fakeEditor();
    const handle = attachDecodeActions(f.editor, deps());
    handle.dispose();
    expect(f.disposeCount()).toBe(5); // 4 actions + 1 mousedown listener
  });
});
