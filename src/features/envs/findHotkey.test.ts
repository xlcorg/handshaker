import { describe, expect, it } from "vitest";

import { isFindHotkey } from "./findHotkey";

const ev = (over: Partial<KeyboardEvent>): Pick<KeyboardEvent, "code" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey"> => ({
  code: "KeyF",
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  shiftKey: false,
  ...over,
});

describe("isFindHotkey", () => {
  it("matches Ctrl+F off macOS and Cmd+F on macOS", () => {
    expect(isFindHotkey(ev({ ctrlKey: true }), false)).toBe(true);
    expect(isFindHotkey(ev({ metaKey: true }), true)).toBe(true);
  });

  it("ignores the other platform's modifier", () => {
    expect(isFindHotkey(ev({ metaKey: true }), false)).toBe(false);
    expect(isFindHotkey(ev({ ctrlKey: true }), true)).toBe(false);
  });

  it("rejects Shift or Alt", () => {
    expect(isFindHotkey(ev({ ctrlKey: true, shiftKey: true }), false)).toBe(false);
    expect(isFindHotkey(ev({ ctrlKey: true, altKey: true }), false)).toBe(false);
  });

  it("reads the physical key, not the typed character", () => {
    expect(isFindHotkey({ ...ev({ ctrlKey: true }), code: "KeyG" }, false)).toBe(false);
    expect(isFindHotkey(ev({ ctrlKey: true, key: "а" }), false)).toBe(true);
  });
});
