import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";

// Capture every editor.updateOptions(...) call so we can assert the size-gate's
// minimap + scrollbar toggle. The fake editor reports an overflowing content
// height so the gate wants the minimap shown.
const captured = vi.hoisted(() => ({ updates: [] as Array<Record<string, unknown>> }));

vi.mock("@/lib/monaco", () => ({
  MonacoEditor: ({ onMount }: { onMount?: (editor: unknown, monaco: unknown) => void }) => {
    const editor = {
      getValue: () => "{}",
      getModel: () => null,
      addCommand: () => {},
      getContribution: () => null,
      onKeyUp: () => ({ dispose: () => {} }),
      // Response-mode decode/fold context-menu actions.
      createContextKey: () => ({ set: () => {} }),
      addAction: () => ({ dispose: () => {} }),
      onMouseDown: () => ({ dispose: () => {} }),
      // Request-mode ghost zone.
      changeViewZones: (cb: (acc: { addZone: () => string; removeZone: () => void }) => void) =>
        cb({ addZone: () => "z", removeZone: () => {} }),
      applyFontInfo: () => {},
      createDecorationsCollection: () => ({ set: () => {}, clear: () => {} }),
      // Size-gate surface: content (5000) overflows the viewport (100) → minimap wanted.
      getContentHeight: () => 5000,
      getLayoutInfo: () => ({ height: 100, contentLeft: 0 }),
      onDidContentSizeChange: () => ({ dispose: () => {} }),
      onDidLayoutChange: () => ({ dispose: () => {} }),
      updateOptions: (o: Record<string, unknown>) => captured.updates.push(o),
    };
    onMount?.(editor, {
      KeyMod: { CtrlCmd: 2048 },
      KeyCode: { Enter: 3 },
      editor: { setModelMarkers: () => {} },
      MarkerSeverity: { Error: 8 },
      Range: class {},
    });
    return <div data-testid="monaco" />;
  },
  BODY_EDIT_OPTIONS: { readOnly: false },
  BODY_READONLY_OPTIONS: { readOnly: true },
  MONACO_THEME: "handshaker-dark",
}));
vi.mock("@/lib/use-prefs", () => ({
  usePrefs: () => [{ bodyHints: false }],
  readPrefs: () => ({ bodyHints: false }),
}));
vi.mock("./controller", () => ({
  attachBodyController: () => ({ dispose: () => {} }),
  BADGE_CLASS: "badge",
}));

import { BodyView } from "./BodyView";

describe("BodyView minimap size-gate", () => {
  beforeEach(() => {
    captured.updates = [];
  });

  // Both editors share the same large-body experience: on overflow the minimap
  // appears and the redundant vertical scrollbar is hidden (no two parallel bars).
  it("gates the minimap + hides the vertical scrollbar for the RESPONSE body", () => {
    render(<BodyView mode="response" value="{}" />);
    const last = captured.updates.at(-1);
    expect(last?.minimap).toMatchObject({ enabled: true, showSlider: "always" });
    expect(last?.scrollbar).toMatchObject({ vertical: "hidden" });
  });

  it("gates the minimap + hides the vertical scrollbar for the REQUEST body (uniformity)", () => {
    render(<BodyView mode="request" value="{}" onChange={vi.fn()} />);
    const last = captured.updates.at(-1);
    expect(last?.minimap).toMatchObject({ enabled: true, showSlider: "always" });
    expect(last?.scrollbar).toMatchObject({ vertical: "hidden" });
  });
});
