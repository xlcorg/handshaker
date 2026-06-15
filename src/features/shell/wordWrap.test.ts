import { describe, it, expect } from "vitest";
import { isWordWrapHotkey } from "./wordWrap";

const base = { code: "KeyZ", ctrlKey: false, metaKey: false, altKey: true, shiftKey: false };

describe("isWordWrapHotkey", () => {
  it("Alt+Z (physical KeyZ) → true", () => {
    expect(isWordWrapHotkey(base)).toBe(true);
  });
  it("ignores AltGr (Ctrl+Alt) → false", () => {
    expect(isWordWrapHotkey({ ...base, ctrlKey: true })).toBe(false);
  });
  it("ignores Meta+Alt → false", () => {
    expect(isWordWrapHotkey({ ...base, metaKey: true })).toBe(false);
  });
  it("ignores Shift → false", () => {
    expect(isWordWrapHotkey({ ...base, shiftKey: true })).toBe(false);
  });
  it("requires Alt → false without it", () => {
    expect(isWordWrapHotkey({ ...base, altKey: false })).toBe(false);
  });
  it("only the physical Z key → false for KeyY", () => {
    expect(isWordWrapHotkey({ ...base, code: "KeyY" })).toBe(false);
  });
  it("layout-independent: matches by code, not key (ЙЦУКЕН 'я')", () => {
    expect(isWordWrapHotkey({ ...base, code: "KeyZ" })).toBe(true);
  });
});
