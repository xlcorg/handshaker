import { describe, it, expect, vi } from "vitest";
import { attachSaveResponseAction, type SaveMenuEditor } from "./saveAction";
import { messages } from "@/lib/messages";

function mockMenuEditor() {
  const descriptors: { id: string; label: string; contextMenuGroupId?: string; contextMenuOrder?: number; run(): void }[] = [];
  const disposers: ReturnType<typeof vi.fn>[] = [];
  const addAction = vi.fn((d: (typeof descriptors)[number]) => {
    descriptors.push(d);
    const dispose = vi.fn();
    disposers.push(dispose);
    return { dispose };
  });
  return { editor: { addAction } as unknown as SaveMenuEditor, descriptors, disposers };
}

describe("attachSaveResponseAction", () => {
  it("registers a 'Save response to file…' context-menu action", () => {
    const m = mockMenuEditor();
    attachSaveResponseAction(m.editor, vi.fn());
    expect(m.descriptors).toHaveLength(1);
    expect(m.descriptors[0].id).toBe("hs.saveResponse");
    expect(m.descriptors[0].label).toBe(messages.response.save.toFileMenu);
    expect(m.descriptors[0].contextMenuGroupId).toBe("1_folding");
  });

  it("run() invokes the save callback", () => {
    const m = mockMenuEditor();
    const onSave = vi.fn();
    attachSaveResponseAction(m.editor, onSave);
    m.descriptors[0].run();
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it("dispose() removes the action", () => {
    const m = mockMenuEditor();
    attachSaveResponseAction(m.editor, vi.fn()).dispose();
    expect(m.disposers[0]).toHaveBeenCalledTimes(1);
  });
});
