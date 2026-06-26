import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";

// Capture every editor.addAction(...) descriptor so we can find the word-wrap toggle.
// `mounted` guards onMount to a SINGLE call (like the ghost test): otherwise the mock
// re-runs onMount on every render and the re-register-on-pref-flip test would pass via
// onMount re-running rather than the effect under test.
const captured = vi.hoisted(() => ({
  actions: [] as Array<{ id: string; label: string; contextMenuGroupId?: string; run: () => void }>,
  mounted: false,
}));
// Shared prefs the mock's setPref mutates — proves BodyView's toggle is wired to it.
const state = vi.hoisted(() => ({
  prefs: { bodyHints: false, wordWrap: false } as { bodyHints: boolean; wordWrap: boolean },
}));

vi.mock("@/lib/monaco", () => ({
  MonacoEditor: ({ onMount }: { onMount?: (editor: unknown, monaco: unknown) => void }) => {
    if (!captured.mounted) {
      captured.mounted = true;
      const editor = {
        getValue: () => "{}",
        getModel: () => null,
        addCommand: () => {},
        getContribution: () => null,
        onContextMenu: () => ({ dispose: () => {} }),
        onKeyUp: () => ({ dispose: () => {} }),
        createContextKey: () => ({ set: () => {} }),
        addAction: (d: { id: string; label: string; contextMenuGroupId?: string; run: () => void }) => {
          captured.actions.push(d);
          return { dispose: () => {} };
        },
        onMouseDown: () => ({ dispose: () => {} }),
        changeViewZones: (cb: (acc: { addZone: () => string; removeZone: () => void }) => void) =>
          cb({ addZone: () => "z", removeZone: () => {} }),
        applyFontInfo: () => {},
        createDecorationsCollection: () => ({ set: () => {}, clear: () => {} }),
        getContentHeight: () => 0,
        getLayoutInfo: () => ({ height: 100, contentLeft: 0 }),
        onDidContentSizeChange: () => ({ dispose: () => {} }),
        onDidLayoutChange: () => ({ dispose: () => {} }),
        updateOptions: () => {},
      };
      onMount?.(editor, {
        KeyMod: { CtrlCmd: 2048 },
        KeyCode: { Enter: 3, KeyR: 48 },
        editor: { setModelMarkers: () => {}, MouseTargetType: { CONTENT_VIEW_ZONE: 8 } },
        MarkerSeverity: { Error: 8 },
        Range: class {},
      });
    }
    return <div data-testid="monaco" />;
  },
  BODY_EDIT_OPTIONS: { readOnly: false },
  BODY_READONLY_OPTIONS: { readOnly: true },
  MONACO_THEME: "handshaker-dark",
}));
vi.mock("@/lib/use-prefs", () => ({
  usePrefs: () => [
    state.prefs,
    (k: string, v: unknown) => {
      (state.prefs as Record<string, unknown>)[k] = v;
    },
  ],
  readPrefs: () => state.prefs,
  setPref: (k: string, v: unknown) => {
    (state.prefs as Record<string, unknown>)[k] = v;
  },
}));
vi.mock("./controller", () => ({
  attachBodyController: () => ({ dispose: () => {} }),
  BADGE_CLASS: "badge",
}));

import { BodyView } from "./BodyView";

const wrapActions = () => captured.actions.filter((a) => a.id === "hs.toggleWordWrap");

describe("BodyView word-wrap context-menu action", () => {
  beforeEach(() => {
    captured.actions = [];
    captured.mounted = false;
    state.prefs = { bodyHints: false, wordWrap: false };
  });

  it("registers the toggle in the REQUEST editor", () => {
    render(<BodyView mode="request" value="{}" onChange={vi.fn()} />);
    expect(wrapActions().length).toBeGreaterThan(0);
  });

  it("registers the toggle in the RESPONSE editor", () => {
    render(<BodyView mode="response" value="{}" />);
    expect(wrapActions().length).toBeGreaterThan(0);
  });

  it("labels the action by the current pref ('Enable' when wrap is off)", () => {
    render(<BodyView mode="request" value="{}" onChange={vi.fn()} />);
    expect(wrapActions().at(-1)!.label).toBe("Enable word wrap");
  });

  it("running the action flips prefs.wordWrap via setPref", () => {
    render(<BodyView mode="request" value="{}" onChange={vi.fn()} />);
    expect(state.prefs.wordWrap).toBe(false);
    wrapActions().at(-1)!.run();
    expect(state.prefs.wordWrap).toBe(true);
  });

  it("re-registers with a fresh label when the pref flips", () => {
    const { rerender } = render(<BodyView mode="response" value="{}" />);
    expect(wrapActions().at(-1)!.label).toBe("Enable word wrap");
    state.prefs = { ...state.prefs, wordWrap: true };
    rerender(<BodyView mode="response" value="{}" />);
    expect(wrapActions().at(-1)!.label).toBe("Disable word wrap");
  });
});
