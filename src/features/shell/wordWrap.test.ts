import { describe, it, expect } from "vitest";
import { isWordWrapHotkey } from "./wordWrap";

describe("isWordWrapHotkey", () => {
  describe("Windows/Linux (mac=false): Alt+Z", () => {
    const base = { code: "KeyZ", ctrlKey: false, metaKey: false, altKey: true, shiftKey: false };
    it("Alt+Z (physical KeyZ) → true", () => {
      expect(isWordWrapHotkey(base, false)).toBe(true);
    });
    it("ignores AltGr (Ctrl+Alt) → false", () => {
      expect(isWordWrapHotkey({ ...base, ctrlKey: true }, false)).toBe(false);
    });
    it("ignores Meta+Alt → false", () => {
      expect(isWordWrapHotkey({ ...base, metaKey: true }, false)).toBe(false);
    });
    it("ignores Shift → false", () => {
      expect(isWordWrapHotkey({ ...base, shiftKey: true }, false)).toBe(false);
    });
    it("requires Alt → false without it", () => {
      expect(isWordWrapHotkey({ ...base, altKey: false }, false)).toBe(false);
    });
    it("only the physical Z key → false for KeyY", () => {
      expect(isWordWrapHotkey({ ...base, code: "KeyY" }, false)).toBe(false);
    });
  });

  describe("macOS (mac=true): ⌥⌘Z", () => {
    const mbase = { code: "KeyZ", ctrlKey: false, metaKey: true, altKey: true, shiftKey: false };
    it("⌥⌘Z (Option+Command+Z) → true", () => {
      expect(isWordWrapHotkey(mbase, true)).toBe(true);
    });
    it("plain ⌥Z (no Command) → false — avoids the Ω/global-app conflict", () => {
      expect(isWordWrapHotkey({ ...mbase, metaKey: false }, true)).toBe(false);
    });
    it("ignores Control → false", () => {
      expect(isWordWrapHotkey({ ...mbase, ctrlKey: true }, true)).toBe(false);
    });
    it("ignores Shift → false", () => {
      expect(isWordWrapHotkey({ ...mbase, shiftKey: true }, true)).toBe(false);
    });
    it("only the physical Z key → false for KeyY", () => {
      expect(isWordWrapHotkey({ ...mbase, code: "KeyY" }, true)).toBe(false);
    });
  });

  it("matches by physical code, so any keyboard layout works", () => {
    // On a Cyrillic layout the Z key yields e.key='я' while e.code stays 'KeyZ'.
    // The predicate consults only e.code (its Pick omits e.key), so it matches regardless.
    const win = new KeyboardEvent("keydown", { code: "KeyZ", altKey: true });
    expect(isWordWrapHotkey(win, false)).toBe(true);
    const mac = new KeyboardEvent("keydown", { code: "KeyZ", altKey: true, metaKey: true });
    expect(isWordWrapHotkey(mac, true)).toBe(true);
  });
});
