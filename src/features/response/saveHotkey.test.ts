import { describe, it, expect } from "vitest";
import { isSaveResponseHotkey } from "./saveHotkey";

type E = Parameters<typeof isSaveResponseHotkey>[0];
const ev = (over: Partial<E>): E => ({
  code: "KeyS", ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...over,
});

describe("isSaveResponseHotkey", () => {
  it("Ctrl+S is the hotkey on Windows/Linux", () => {
    expect(isSaveResponseHotkey(ev({ ctrlKey: true }), false)).toBe(true);
  });
  it("Cmd+S is the hotkey on macOS", () => {
    expect(isSaveResponseHotkey(ev({ metaKey: true }), true)).toBe(true);
  });
  it("Ctrl+S does NOT fire on macOS", () => {
    expect(isSaveResponseHotkey(ev({ ctrlKey: true }), true)).toBe(false);
  });
  it("Cmd+S does NOT fire on Windows/Linux", () => {
    expect(isSaveResponseHotkey(ev({ metaKey: true }), false)).toBe(false);
  });
  it("AltGr (ctrl+alt) does NOT fire", () => {
    expect(isSaveResponseHotkey(ev({ ctrlKey: true, altKey: true }), false)).toBe(false);
  });
  it("Shift+Ctrl+S does NOT fire", () => {
    expect(isSaveResponseHotkey(ev({ ctrlKey: true, shiftKey: true }), false)).toBe(false);
  });
  it("matches by physical key — a non-KeyS code never fires", () => {
    expect(isSaveResponseHotkey(ev({ code: "KeyD", ctrlKey: true }), false)).toBe(false);
  });
});
