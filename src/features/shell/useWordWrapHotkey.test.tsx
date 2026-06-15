import { describe, it, expect, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import { act } from "react";
import { useWordWrapHotkey } from "./wordWrap";
import { readPrefs } from "@/lib/use-prefs";

function Probe() {
  useWordWrapHotkey();
  return null;
}

const press = (init: KeyboardEventInit) =>
  act(() => {
    window.dispatchEvent(new KeyboardEvent("keydown", { cancelable: true, ...init }));
  });

beforeEach(() => {
  localStorage.clear();
});

describe("useWordWrapHotkey", () => {
  it("Alt+Z toggles the wordWrap pref both ways", () => {
    render(<Probe />);
    const start = readPrefs().wordWrap;
    press({ code: "KeyZ", altKey: true });
    expect(readPrefs().wordWrap).toBe(!start);
    press({ code: "KeyZ", altKey: true });
    expect(readPrefs().wordWrap).toBe(start);
  });

  it("ignores AltGr (Ctrl+Alt)+Z", () => {
    render(<Probe />);
    const start = readPrefs().wordWrap;
    press({ code: "KeyZ", altKey: true, ctrlKey: true });
    expect(readPrefs().wordWrap).toBe(start);
  });

  it("preventDefault on a real Alt+Z (suppresses Monaco's built-in)", () => {
    render(<Probe />);
    const e = new KeyboardEvent("keydown", { code: "KeyZ", altKey: true, cancelable: true });
    act(() => {
      window.dispatchEvent(e);
    });
    expect(e.defaultPrevented).toBe(true);
  });
});
