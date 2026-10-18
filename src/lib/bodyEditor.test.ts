import { describe, expect, it, vi } from "vitest";

vi.mock("monaco-editor", () => ({
  languages: {
    register: () => {},
    setLanguageConfiguration: () => {},
    setMonarchTokensProvider: () => {},
    registerCompletionItemProvider: () => ({ dispose: () => {} }),
  },
  editor: {
    addKeybindingRule: () => {},
    defineTheme: () => {},
  },
  KeyMod: { Alt: 512 },
  KeyCode: { KeyZ: 56 },
}));
vi.mock("monaco-editor/esm/vs/editor/editor.worker?worker", () => ({
  default: class EditorWorker {},
}));
vi.mock("monaco-editor/esm/vs/language/json/json.worker?worker", () => ({
  default: class JsonWorker {},
}));
vi.mock("@monaco-editor/loader", () => ({
  default: { config: () => {} },
}));
vi.mock("@monaco-editor/react", () => ({
  default: function MonacoEditor() {
    return null;
  },
}));

import { createBodyEditor, EDITOR_OPTIONS } from "@/lib/monaco";

const VIEW_ZONE = 8;
const CONTENT_TEXT = 6;

type CtxEvent = {
  target: { type: number };
  event: { posx: number; posy: number; preventDefault(): void };
};

function fakeEditor() {
  const showContextMenu = vi.fn();
  const dispose = vi.fn();
  const updates: Array<{
    minimap: { enabled: boolean; renderCharacters: boolean; showSlider: "always" };
    scrollbar: {
      vertical: "hidden" | "auto";
      verticalScrollbarSize: number;
      horizontalScrollbarSize: number;
      scrollByPage: boolean;
    };
  }> = [];
  const model = { setValue: vi.fn() };
  let sub: ((e: CtxEvent) => void) | null = null;
  let contribution: {
    showContextMenu?: (anchor: { x: number; y: number }) => void;
  } | null = {
    showContextMenu,
  };
  const editor = {
    getValue: () => "before",
    getModel: () => model,
    updateOptions: (options: {
      minimap: { enabled: boolean; renderCharacters: boolean; showSlider: "always" };
      scrollbar: {
        vertical: "hidden" | "auto";
        verticalScrollbarSize: number;
        horizontalScrollbarSize: number;
        scrollByPage: boolean;
      };
    }) => {
      updates.push(options);
    },
    getContribution: () => contribution,
    onContextMenu: (fn: (e: CtxEvent) => void) => {
      sub = fn;
      return { dispose };
    },
  };
  return {
    editor,
    showContextMenu,
    dispose,
    updates,
    model,
    setContribution: (next: typeof contribution) => {
      contribution = next;
    },
    fire: (e: CtxEvent) => sub?.(e),
  };
}

describe("BodyEditor", () => {
  it("does not expose updateOptions", () => {
    const handle = createBodyEditor(fakeEditor().editor, VIEW_ZONE);
    expect(Object.keys(handle).sort()).toEqual(
      ["dispose", "getValue", "onContextMenu", "setMinimap", "setValue"].sort(),
    );
    expect(handle).not.toHaveProperty("updateOptions");
  });

  it("reads and writes the model value", () => {
    const f = fakeEditor();
    const handle = createBodyEditor(f.editor, VIEW_ZONE);
    expect(handle.getValue()).toBe("before");
    handle.setValue("after");
    expect(f.model.setValue).toHaveBeenCalledWith("after");
  });

  it("setMinimap hides the vertical scrollbar and re-specifies the sibling fields", () => {
    const f = fakeEditor();
    const handle = createBodyEditor(f.editor, VIEW_ZONE);
    handle.setMinimap(true);
    expect(f.updates[0]).toMatchObject({
      minimap: { enabled: true, renderCharacters: false, showSlider: "always" },
      scrollbar: {
        vertical: "hidden",
        verticalScrollbarSize: 0,
        horizontalScrollbarSize:
          EDITOR_OPTIONS.scrollbar.horizontalScrollbarSize,
        scrollByPage: EDITOR_OPTIONS.scrollbar.scrollByPage,
      },
    });
  });

  it("setMinimap restores the grabbable scrollbar when the minimap hides", () => {
    const f = fakeEditor();
    const handle = createBodyEditor(f.editor, VIEW_ZONE);
    handle.setMinimap(false);
    expect(f.updates[0]).toMatchObject({
      minimap: { enabled: false, showSlider: "always" },
      scrollbar: {
        vertical: "auto",
        verticalScrollbarSize: EDITOR_OPTIONS.scrollbar.verticalScrollbarSize,
        horizontalScrollbarSize:
          EDITOR_OPTIONS.scrollbar.horizontalScrollbarSize,
        scrollByPage: true,
      },
    });
  });

  it("opens the menu at the page coords for a view-zone right-click", () => {
    const f = fakeEditor();
    const handle = createBodyEditor(f.editor, VIEW_ZONE);
    const seen = vi.fn();
    handle.onContextMenu(seen);
    const preventDefault = vi.fn();
    f.fire({
      target: { type: VIEW_ZONE },
      event: { posx: 100, posy: 200, preventDefault },
    });
    expect(preventDefault).toHaveBeenCalled();
    expect(f.showContextMenu).toHaveBeenCalledWith({ x: 100, y: 200 });
    expect(seen).toHaveBeenCalledWith({
      pageX: 100,
      pageY: 200,
      onViewZone: true,
    });
  });

  it("ignores right-clicks on non-view-zone targets", () => {
    const f = fakeEditor();
    const handle = createBodyEditor(f.editor, VIEW_ZONE);
    const seen = vi.fn();
    handle.onContextMenu(seen);
    const preventDefault = vi.fn();
    f.fire({
      target: { type: CONTENT_TEXT },
      event: { posx: 1, posy: 2, preventDefault },
    });
    expect(preventDefault).not.toHaveBeenCalled();
    expect(f.showContextMenu).not.toHaveBeenCalled();
    expect(seen).toHaveBeenCalledWith({
      pageX: 1,
      pageY: 2,
      onViewZone: false,
    });
  });

  it("no-ops when the context-menu contribution is absent", () => {
    const f = fakeEditor();
    f.setContribution(null);
    createBodyEditor(f.editor, VIEW_ZONE);
    expect(() =>
      f.fire({
        target: { type: VIEW_ZONE },
        event: { posx: 1, posy: 2, preventDefault: vi.fn() },
      }),
    ).not.toThrow();
  });

  it("no-ops when the contribution lacks showContextMenu", () => {
    const f = fakeEditor();
    f.setContribution({});
    createBodyEditor(f.editor, VIEW_ZONE);
    expect(() =>
      f.fire({
        target: { type: VIEW_ZONE },
        event: { posx: 1, posy: 2, preventDefault: vi.fn() },
      }),
    ).not.toThrow();
  });

  it("dispose drops the context-menu subscription once", () => {
    const f = fakeEditor();
    const handle = createBodyEditor(f.editor, VIEW_ZONE);
    handle.dispose();
    handle.dispose();
    expect(f.dispose).toHaveBeenCalledTimes(1);
  });
});
