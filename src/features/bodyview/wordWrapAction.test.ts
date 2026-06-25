import { describe, it, expect, vi } from "vitest";
import { attachWordWrapAction, type WordWrapMenuEditor } from "./wordWrapAction";

/** A mock menu editor recording registered descriptors + their disposers. */
function mockMenuEditor() {
  const descriptors: {
    id: string;
    label: string;
    contextMenuGroupId?: string;
    contextMenuOrder?: number;
    run(): void;
  }[] = [];
  const disposers: ReturnType<typeof vi.fn>[] = [];
  const addAction = vi.fn((d: (typeof descriptors)[number]) => {
    descriptors.push(d);
    const dispose = vi.fn();
    disposers.push(dispose);
    return { dispose };
  });
  return { editor: { addAction } as unknown as WordWrapMenuEditor, descriptors, disposers };
}

describe("attachWordWrapAction", () => {
  it("labels the action 'Enable word wrap' when wrap is OFF", () => {
    const m = mockMenuEditor();
    attachWordWrapAction(m.editor, false, vi.fn());
    expect(m.descriptors[0].label).toBe("Enable word wrap");
  });

  it("labels the action 'Disable word wrap' when wrap is ON", () => {
    const m = mockMenuEditor();
    attachWordWrapAction(m.editor, true, vi.fn());
    expect(m.descriptors[0].label).toBe("Disable word wrap");
  });

  it("registers one action with a stable id in its own ordered group, no keybinding", () => {
    const m = mockMenuEditor();
    attachWordWrapAction(m.editor, false, vi.fn());
    expect(m.descriptors).toHaveLength(1);
    const d = m.descriptors[0];
    expect(d.id).toBe("hs.toggleWordWrap");
    expect(d.contextMenuGroupId).toBe("2_view");
    expect(d.contextMenuOrder).toBe(1);
    expect(d).not.toHaveProperty("keybindings");
  });

  it("run() invokes the supplied toggle", () => {
    const m = mockMenuEditor();
    const onToggle = vi.fn();
    attachWordWrapAction(m.editor, false, onToggle);
    m.descriptors[0].run();
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it("dispose() removes the action", () => {
    const m = mockMenuEditor();
    attachWordWrapAction(m.editor, false, vi.fn()).dispose();
    expect(m.disposers[0]).toHaveBeenCalledTimes(1);
  });
});
