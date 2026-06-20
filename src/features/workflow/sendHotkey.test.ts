import { describe, it, expect } from "vitest";
import { isSendHotkey } from "./sendHotkey";

const ev = (init: KeyboardEventInit) => new KeyboardEvent("keydown", init);

describe("isSendHotkey", () => {
  it("matches Ctrl+Enter", () => {
    expect(isSendHotkey(ev({ key: "Enter", ctrlKey: true }))).toBe(true);
  });

  it("matches Cmd+Enter", () => {
    expect(isSendHotkey(ev({ key: "Enter", metaKey: true }))).toBe(true);
  });

  it("matches Ctrl+R by physical code", () => {
    expect(isSendHotkey(ev({ code: "KeyR", key: "r", ctrlKey: true }))).toBe(true);
  });

  it("matches Cmd+R", () => {
    expect(isSendHotkey(ev({ code: "KeyR", key: "r", metaKey: true }))).toBe(true);
  });

  it("matches Ctrl+R on a non-QWERTY layout (e.key is not 'r')", () => {
    // ЙЦУКЕН: the physical R key yields e.key === "к" — physical-code match still fires.
    expect(isSendHotkey(ev({ code: "KeyR", key: "к", ctrlKey: true }))).toBe(true);
  });

  it("ignores AltGr+R (Ctrl+Alt) so a composed character never sends", () => {
    expect(isSendHotkey(ev({ code: "KeyR", key: "®", ctrlKey: true, altKey: true }))).toBe(false);
  });

  it("ignores plain R", () => {
    expect(isSendHotkey(ev({ code: "KeyR", key: "r" }))).toBe(false);
  });

  it("ignores plain Enter", () => {
    expect(isSendHotkey(ev({ key: "Enter" }))).toBe(false);
  });

  it("ignores unrelated Ctrl chords", () => {
    expect(isSendHotkey(ev({ code: "KeyS", key: "s", ctrlKey: true }))).toBe(false);
  });
});
