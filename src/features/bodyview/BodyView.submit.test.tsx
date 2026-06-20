import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";

// Capture every keybinding + handler BodyView registers via editor.addCommand.
const captured = vi.hoisted(() => ({
  commands: [] as Array<{ keybinding: number; handler: () => void }>,
}));

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
      KeyCode: { Enter: 3, KeyR: 48 },
    };
    const editor = {
      getValue: () => "{}",
      addCommand: (keybinding: number, handler: () => void) => {
        captured.commands.push({ keybinding, handler });
      },
      getModel: () => null,
      getLayoutInfo: () => ({ contentLeft: 0 }),
      // Request mode subscribes to keyup to force-open the suggest widget on `"`.
      onKeyUp: () => ({ dispose: () => {} }),
      // Response mode attaches the base64 decode context-menu actions.
      createContextKey: () => ({ set: () => {} }),
      addAction: () => ({ dispose: () => {} }),
      onMouseDown: () => ({ dispose: () => {} }),
      // onMount strips Monaco's "Command Palette" context-menu item; the cleanup
      // no-ops when getContribution yields nothing.
      getContribution: () => null,
      // Response mode size-gates the minimap on content/layout changes.
      getContentHeight: () => 0,
      onDidContentSizeChange: () => ({ dispose: () => {} }),
      onDidLayoutChange: () => ({ dispose: () => {} }),
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

describe("BodyView Send submit shortcuts", () => {
  beforeEach(() => {
    captured.commands = [];
  });

  it("binds Ctrl/Cmd+Enter and forwards it to onSubmit", () => {
    const onSubmit = vi.fn();
    render(<BodyView mode="request" value="{}" onChange={vi.fn()} onSubmit={onSubmit} />);
    // CtrlCmd | Enter === 2048 | 3
    const enter = captured.commands.find((c) => c.keybinding === (2048 | 3));
    expect(enter).toBeDefined();
    enter!.handler();
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("also binds Ctrl/Cmd+R and forwards it to onSubmit", () => {
    const onSubmit = vi.fn();
    render(<BodyView mode="request" value="{}" onChange={vi.fn()} onSubmit={onSubmit} />);
    // CtrlCmd | KeyR === 2048 | 48
    const ctrlR = captured.commands.find((c) => c.keybinding === (2048 | 48));
    expect(ctrlR).toBeDefined();
    ctrlR!.handler();
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  // Regression: the read-only response editor (no onSubmit) must NOT register any
  // command — Monaco's addCommand is global/last-wins, so a no-op registration
  // would clobber the request editor's shortcuts after the first response renders.
  it("does not bind any command when there is no onSubmit (response editor)", () => {
    render(<BodyView mode="response" value="{}" />);
    expect(captured.commands).toHaveLength(0);
  });
});
