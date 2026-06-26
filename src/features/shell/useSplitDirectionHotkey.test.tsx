import { describe, it, expect, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import { act } from "react";
import { useSplitDirectionHotkey } from "./splitDirection";
import { readPrefs, setPref } from "@/lib/use-prefs";

function Probe() {
  useSplitDirectionHotkey();
  return null;
}

const press = (init: KeyboardEventInit) =>
  act(() => {
    window.dispatchEvent(new KeyboardEvent("keydown", { cancelable: true, ...init }));
  });

beforeEach(() => {
  setPref("split", "vertical"); // детерминированный старт (in-memory + localStorage)
});

describe("useSplitDirectionHotkey", () => {
  it("Alt+V toggles the split pref both ways", () => {
    render(<Probe />);
    expect(readPrefs().split).toBe("vertical");
    press({ code: "KeyV", altKey: true });
    expect(readPrefs().split).toBe("horizontal");
    press({ code: "KeyV", altKey: true });
    expect(readPrefs().split).toBe("vertical");
  });

  it("ignores AltGr (Ctrl+Alt)+V", () => {
    render(<Probe />);
    press({ code: "KeyV", altKey: true, ctrlKey: true });
    expect(readPrefs().split).toBe("vertical");
  });

  it("preventDefault on a real Alt+V (suppresses any stray handler)", () => {
    render(<Probe />);
    const e = new KeyboardEvent("keydown", { code: "KeyV", altKey: true, cancelable: true });
    act(() => {
      window.dispatchEvent(e);
    });
    expect(e.defaultPrevented).toBe(true);
  });
});
