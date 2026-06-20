import { describe, it, expect } from "vitest";
import { isEnvEditHotkey } from "./openEditor";

// Minimal event shape the predicate inspects.
const ev = (over: Partial<KeyboardEvent>): Pick<
  KeyboardEvent,
  "code" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey"
> => ({ code: "KeyE", ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...over });

describe("isEnvEditHotkey", () => {
  it("matches Ctrl+Shift+E (physical KeyE)", () => {
    expect(isEnvEditHotkey(ev({ ctrlKey: true, shiftKey: true }))).toBe(true);
  });
  it("matches Cmd+Shift+E", () => {
    expect(isEnvEditHotkey(ev({ metaKey: true, shiftKey: true }))).toBe(true);
  });
  it("rejects Ctrl+E without Shift (that is the cycle hotkey)", () => {
    expect(isEnvEditHotkey(ev({ ctrlKey: true }))).toBe(false);
  });
  it("rejects when Alt is held (AltGr = Ctrl+Alt on euro layouts)", () => {
    expect(isEnvEditHotkey(ev({ ctrlKey: true, shiftKey: true, altKey: true }))).toBe(false);
  });
  it("rejects a different physical key", () => {
    expect(isEnvEditHotkey(ev({ ctrlKey: true, shiftKey: true, code: "KeyK" }))).toBe(false);
  });
  it("rejects Shift+E without a modifier", () => {
    expect(isEnvEditHotkey(ev({ shiftKey: true }))).toBe(false);
  });
});
