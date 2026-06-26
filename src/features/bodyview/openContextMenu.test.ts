import { describe, it, expect, vi } from "vitest";
import { openEditorContextMenu, forwardViewZoneContextMenu } from "./openContextMenu";

const VIEW_ZONE = 8; // MouseTargetType.CONTENT_VIEW_ZONE
const CONTENT_TEXT = 6;

type CtxEvent = {
  target: { type: number };
  event: { posx: number; posy: number; preventDefault(): void };
};

/** Fake editor that captures the onContextMenu subscriber so a test can fire it. */
function fakeEditor() {
  const showContextMenu = vi.fn();
  const dispose = vi.fn();
  let sub: ((e: CtxEvent) => void) | null = null;
  const editor = {
    getContribution: () => ({ showContextMenu }),
    onContextMenu: (fn: (e: CtxEvent) => void) => {
      sub = fn;
      return { dispose };
    },
  };
  return { editor, showContextMenu, dispose, fire: (e: CtxEvent) => sub?.(e) };
}

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

describe("forwardViewZoneContextMenu", () => {
  it("opens the menu at the page coords for a view-zone right-click", () => {
    const f = fakeEditor();
    forwardViewZoneContextMenu(f.editor, VIEW_ZONE);
    const preventDefault = vi.fn();
    f.fire({ target: { type: VIEW_ZONE }, event: { posx: 100, posy: 200, preventDefault } });
    expect(preventDefault).toHaveBeenCalled();
    expect(f.showContextMenu).toHaveBeenCalledWith({ x: 100, y: 200 });
  });

  it("ignores right-clicks on non-view-zone targets (text already gets Monaco's menu)", () => {
    const f = fakeEditor();
    forwardViewZoneContextMenu(f.editor, VIEW_ZONE);
    const preventDefault = vi.fn();
    f.fire({ target: { type: CONTENT_TEXT }, event: { posx: 1, posy: 2, preventDefault } });
    expect(preventDefault).not.toHaveBeenCalled();
    expect(f.showContextMenu).not.toHaveBeenCalled();
  });

  it("returns the subscription disposable", () => {
    const f = fakeEditor();
    const d = forwardViewZoneContextMenu(f.editor, VIEW_ZONE);
    d.dispose();
    expect(f.dispose).toHaveBeenCalledTimes(1);
  });
});
