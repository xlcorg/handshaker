import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";

// Capture the keybinding + handler that BodyView registers via editor.addCommand.
const captured = vi.hoisted(() => ({ keybinding: 0, handler: undefined as undefined | (() => void) }));

// Mock Monaco so the MonacoEditor stub actually invokes onMount with a fake
// editor/monaco — the default BodyView.test mock does not, so onMount (and the
// Ctrl+Enter command it registers) goes untested there.
vi.mock("@/lib/monaco", () => ({
  MonacoEditor: ({
    onMount,
  }: {
    onMount?: (editor: unknown, monaco: unknown) => void;
  }) => {
    const monaco = {
      KeyMod: { CtrlCmd: 2048 },
      KeyCode: { Enter: 3 },
    };
    const editor = {
      getValue: () => "{}",
      addCommand: (keybinding: number, handler: () => void) => {
        captured.keybinding = keybinding;
        captured.handler = handler;
      },
      getModel: () => null,
      getLayoutInfo: () => ({ contentLeft: 0 }),
      // Request mode subscribes to keyup to force-open the suggest widget on `"`.
      onKeyUp: () => ({ dispose: () => {} }),
      changeViewZones: (cb: (acc: { addZone: () => string; removeZone: () => void }) => void) => {
        cb({ addZone: () => "z1", removeZone: () => {} });
      },
      createDecorationsCollection: () => ({ set: () => {}, clear: () => {} }),
    };
    onMount?.(editor, monaco);
    return <div data-testid="monaco" />;
  },
  BODY_EDIT_OPTIONS: { readOnly: false },
  BODY_READONLY_OPTIONS: { readOnly: true },
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

describe("BodyView Ctrl+Enter submit", () => {
  beforeEach(() => {
    captured.keybinding = 0;
    captured.handler = undefined;
  });

  it("binds Ctrl/Cmd+Enter and forwards it to onSubmit", () => {
    const onSubmit = vi.fn();
    render(<BodyView mode="request" value="{}" onChange={vi.fn()} onSubmit={onSubmit} />);
    // CtrlCmd | Enter === 2048 | 3
    expect(captured.keybinding).toBe(2048 | 3);
    captured.handler?.();
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  // Regression: the read-only response editor (no onSubmit) must NOT register the
  // command — Monaco's addCommand is global/last-wins, so a no-op registration
  // would clobber the request editor's shortcut after the first response renders.
  it("does not bind the command when there is no onSubmit (response editor)", () => {
    render(<BodyView mode="response" value="{}" />);
    expect(captured.handler).toBeUndefined();
  });
});
