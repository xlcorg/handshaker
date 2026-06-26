import { describe, it, expect } from "vitest";
import { isSplitToggleHotkey, nextSplit } from "./splitDirection";

type KeyInit = Parameters<typeof isSplitToggleHotkey>[0];
const ev = (over: Partial<KeyInit>): KeyInit => ({
  code: "KeyV",
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  shiftKey: false,
  ...over,
});

describe("nextSplit", () => {
  it("toggles both ways", () => {
    expect(nextSplit("horizontal")).toBe("vertical");
    expect(nextSplit("vertical")).toBe("horizontal");
  });
});

describe("isSplitToggleHotkey on Windows/Linux (mac=false)", () => {
  it("accepts Alt+V", () => {
    expect(isSplitToggleHotkey(ev({ altKey: true }), false)).toBe(true);
  });
  it("rejects AltGr (Ctrl+Alt)+V, Shift, Meta, bare V, and other keys", () => {
    expect(isSplitToggleHotkey(ev({ altKey: true, ctrlKey: true }), false)).toBe(false);
    expect(isSplitToggleHotkey(ev({ altKey: true, shiftKey: true }), false)).toBe(false);
    expect(isSplitToggleHotkey(ev({ altKey: true, metaKey: true }), false)).toBe(false);
    expect(isSplitToggleHotkey(ev({ altKey: false }), false)).toBe(false);
    expect(isSplitToggleHotkey(ev({ code: "KeyZ", altKey: true }), false)).toBe(false);
  });
});

describe("isSplitToggleHotkey on macOS (mac=true)", () => {
  it("accepts ⌥⌘V (Alt+Meta+V)", () => {
    expect(isSplitToggleHotkey(ev({ altKey: true, metaKey: true }), true)).toBe(true);
  });
  it("rejects bare ⌥V (no Meta) and Ctrl+Alt+V", () => {
    expect(isSplitToggleHotkey(ev({ altKey: true }), true)).toBe(false);
    expect(isSplitToggleHotkey(ev({ altKey: true, metaKey: true, ctrlKey: true }), true)).toBe(false);
  });
});
