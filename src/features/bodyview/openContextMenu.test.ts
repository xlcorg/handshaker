import { describe, it, expect, vi } from "vitest";
import { openEditorContextMenu } from "./openContextMenu";

describe("openEditorContextMenu", () => {
  it("opens the editor's context menu at the given point via the context-menu contribution", () => {
    const showContextMenu = vi.fn();
    const getContribution = vi.fn(() => ({ showContextMenu }));
    openEditorContextMenu({ getContribution }, 12, 34);
    expect(getContribution).toHaveBeenCalledWith("editor.contrib.contextmenu");
    expect(showContextMenu).toHaveBeenCalledWith({ x: 12, y: 34 });
  });

  it("no-ops when the contribution is absent", () => {
    expect(() => openEditorContextMenu({ getContribution: () => null }, 1, 2)).not.toThrow();
  });

  it("no-ops when the contribution lacks showContextMenu", () => {
    expect(() => openEditorContextMenu({ getContribution: () => ({}) }, 1, 2)).not.toThrow();
  });
});
