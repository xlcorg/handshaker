import { describe, it, expect, vi } from "vitest";
import { foldAll, unfoldAll, attachFoldActions, type FoldableEditor, type FoldMenuEditor } from "./foldActions";

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

/** A mock menu editor recording the actions registered + their disposers. */
function mockMenuEditor() {
  const run = vi.fn();
  const getAction = vi.fn((_id: string) => ({ run }));
  const descriptors: { id: string; label: string; contextMenuGroupId?: string; contextMenuOrder?: number; run(): void }[] = [];
  const disposers: ReturnType<typeof vi.fn>[] = [];
  const addAction = vi.fn((d: (typeof descriptors)[number]) => {
    descriptors.push(d);
    const dispose = vi.fn();
    disposers.push(dispose);
    return { dispose };
  });
  return { editor: { getAction, addAction } as unknown as FoldMenuEditor, getAction, run, descriptors, disposers };
}

describe("attachFoldActions", () => {
  it("registers Collapse all + Expand all as context-menu actions in one ordered group", () => {
    const m = mockMenuEditor();
    attachFoldActions(m.editor);
    expect(m.descriptors.map((d) => d.id)).toEqual(["hs.collapseAll", "hs.expandAll"]);
    expect(m.descriptors.map((d) => d.label)).toEqual(["Collapse all", "Expand all"]);
    // Same group, ordered — so they render adjacent under one divider.
    expect(m.descriptors[0].contextMenuGroupId).toBe(m.descriptors[1].contextMenuGroupId);
    expect(m.descriptors[0].contextMenuOrder).toBeLessThan(m.descriptors[1].contextMenuOrder!);
  });

  it("Collapse all runs fold-all; Expand all runs unfold-all", () => {
    const m = mockMenuEditor();
    attachFoldActions(m.editor);
    m.descriptors[0].run();
    expect(m.getAction).toHaveBeenCalledWith("editor.foldAll");
    m.descriptors[1].run();
    expect(m.getAction).toHaveBeenCalledWith("editor.unfoldAll");
  });

  it("dispose() removes both actions", () => {
    const m = mockMenuEditor();
    attachFoldActions(m.editor).dispose();
    expect(m.disposers).toHaveLength(2);
    for (const d of m.disposers) expect(d).toHaveBeenCalledTimes(1);
  });
});
