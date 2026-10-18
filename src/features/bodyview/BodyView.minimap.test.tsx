import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";

// The fake editor reports an overflowing content height so the gate wants the
// minimap shown. BodyView must ask the handle, not the editor.
const captured = vi.hoisted(() => ({ minimap: [] as boolean[] }));

vi.mock("@/lib/monaco", () => ({
  MonacoEditor: ({
    onMount,
  }: {
    onMount?: (editor: unknown, monaco: unknown) => void;
  }) => {
    const editor = {
      getValue: () => "{}",
      getModel: () => null,
      addCommand: () => {},
      getContribution: () => null,
      onContextMenu: () => ({ dispose: () => {} }),
      onKeyUp: () => ({ dispose: () => {} }),
      // Response-mode decode/fold context-menu actions.
      createContextKey: () => ({ set: () => {} }),
      addAction: () => ({ dispose: () => {} }),
      onMouseDown: () => ({ dispose: () => {} }),
      // Request-mode ghost zone.
      changeViewZones: (
        cb: (acc: { addZone: () => string; removeZone: () => void }) => void,
      ) => cb({ addZone: () => "z", removeZone: () => {} }),
      applyFontInfo: () => {},
      createDecorationsCollection: () => ({ set: () => {}, clear: () => {} }),
      // Size-gate surface: content (5000) overflows the viewport (100) → minimap wanted.
      getContentHeight: () => 5000,
      getLayoutInfo: () => ({ height: 100, contentLeft: 0 }),
      onDidContentSizeChange: () => ({ dispose: () => {} }),
      onDidLayoutChange: () => ({ dispose: () => {} }),
    };
    onMount?.(editor, {
      KeyMod: { CtrlCmd: 2048 },
      KeyCode: { Enter: 3 },
      editor: {
        setModelMarkers: () => {},
        MouseTargetType: { CONTENT_VIEW_ZONE: 8 },
      },
      MarkerSeverity: { Error: 8 },
      Range: class {},
    });
    return <div data-testid="monaco" />;
  },
  createBodyEditor: () => ({
    getValue: () => "{}",
    setValue: () => {},
    setMinimap: (on: boolean) => captured.minimap.push(on),
    onContextMenu: () => {},
    dispose: () => {},
  }),
  BODY_EDIT_OPTIONS: { readOnly: false },
  BODY_READONLY_OPTIONS: { readOnly: true },
  MONACO_THEME: "handshaker-dark",
}));
vi.mock("@/lib/use-prefs", () => ({
  usePrefs: () => [{ bodyHints: false, wordWrap: false }],
  readPrefs: () => ({ bodyHints: false, wordWrap: false }),
  setPref: vi.fn(),
}));
vi.mock("./controller", () => ({
  attachBodyController: () => ({ dispose: () => {} }),
  BADGE_CLASS: "badge",
}));

import { BodyView } from "./BodyView";

describe("BodyView minimap size-gate", () => {
  beforeEach(() => {
    captured.minimap = [];
  });

  // Both editors share the same large-body experience: on overflow the minimap
  // is turned on through the handle. The scrollbar payload lives in setMinimap.
  it("turns the minimap on for an overflowing RESPONSE body", () => {
    render(<BodyView mode="response" value="{}" />);
    expect(captured.minimap).toEqual([true]);
  });

  it("turns the minimap on for an overflowing REQUEST body (uniformity)", () => {
    render(<BodyView mode="request" value="{}" onChange={vi.fn()} />);
    expect(captured.minimap).toEqual([true]);
  });
});
