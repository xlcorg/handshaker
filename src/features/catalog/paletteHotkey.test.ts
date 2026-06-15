import { describe, it, expect } from "vitest";
import { isPaletteHotkey } from "./paletteHotkey";

function ev(over: Partial<KeyboardEvent>): KeyboardEvent {
  return { ctrlKey: false, metaKey: false, altKey: false, repeat: false, code: "KeyK", ...over } as KeyboardEvent;
}

describe("isPaletteHotkey", () => {
  it("matches Ctrl+K and Cmd+K", () => {
    expect(isPaletteHotkey(ev({ ctrlKey: true, code: "KeyK" }))).toBe(true);
    expect(isPaletteHotkey(ev({ metaKey: true, code: "KeyK" }))).toBe(true);
  });
  it("matches Ctrl+P and Cmd+P", () => {
    expect(isPaletteHotkey(ev({ ctrlKey: true, code: "KeyP" }))).toBe(true);
    expect(isPaletteHotkey(ev({ metaKey: true, code: "KeyP" }))).toBe(true);
  });
  it("matches by physical code regardless of layout (KeyK even if e.key differs)", () => {
    expect(isPaletteHotkey(ev({ ctrlKey: true, code: "KeyK", key: "л" } as Partial<KeyboardEvent>))).toBe(true);
  });
  it("rejects without a modifier", () => {
    expect(isPaletteHotkey(ev({ code: "KeyK" }))).toBe(false);
  });
  it("rejects AltGr (ctrl+alt) and key repeat", () => {
    expect(isPaletteHotkey(ev({ ctrlKey: true, altKey: true, code: "KeyK" }))).toBe(false);
    expect(isPaletteHotkey(ev({ ctrlKey: true, repeat: true, code: "KeyK" }))).toBe(false);
  });
  it("rejects other keys", () => {
    expect(isPaletteHotkey(ev({ ctrlKey: true, code: "KeyB" }))).toBe(false);
  });
});
