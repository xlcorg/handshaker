import { describe, it, expect, vi } from "vitest";
import { foldAll, unfoldAll, type FoldableEditor } from "./foldActions";

/** A mock editor that records which action id was requested and runs the action. */
function mockEditor() {
  const run = vi.fn();
  const getAction = vi.fn((_id: string) => ({ run }));
  return { editor: { getAction } as FoldableEditor, getAction, run };
}

describe("foldActions", () => {
  it("foldAll runs Monaco's editor.foldAll action", () => {
    const m = mockEditor();
    foldAll(m.editor);
    expect(m.getAction).toHaveBeenCalledWith("editor.foldAll");
    expect(m.run).toHaveBeenCalledTimes(1);
  });

  it("unfoldAll runs Monaco's editor.unfoldAll action", () => {
    const m = mockEditor();
    unfoldAll(m.editor);
    expect(m.getAction).toHaveBeenCalledWith("editor.unfoldAll");
    expect(m.run).toHaveBeenCalledTimes(1);
  });

  it("no-ops safely when the action is unavailable", () => {
    const editor: FoldableEditor = { getAction: () => null };
    expect(() => foldAll(editor)).not.toThrow();
    expect(() => unfoldAll(editor)).not.toThrow();
  });
});
