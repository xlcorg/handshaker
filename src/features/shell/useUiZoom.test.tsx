import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { act } from "react";

const setZoom = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: () => ({ setZoom }),
}));

import { useUiZoom } from "./zoom";
import { readPrefs } from "@/lib/use-prefs";

function Probe() {
  useUiZoom();
  return null;
}

const press = (init: KeyboardEventInit) =>
  act(() => {
    window.dispatchEvent(new KeyboardEvent("keydown", { cancelable: true, ...init }));
  });

beforeEach(() => {
  localStorage.clear();
  setZoom.mockClear();
});

describe("useUiZoom", () => {
  it("applies the persisted zoom on mount", async () => {
    render(<Probe />);
    await waitFor(() => expect(setZoom).toHaveBeenCalledWith(readPrefs().zoom));
  });

  it("Ctrl+= zooms in, Ctrl+- zooms out, Ctrl+0 resets; each re-applies", async () => {
    render(<Probe />);
    const start = readPrefs().zoom;

    press({ key: "=", ctrlKey: true });
    expect(readPrefs().zoom).toBeCloseTo(start + 0.1);
    await waitFor(() => expect(setZoom).toHaveBeenLastCalledWith(readPrefs().zoom));

    press({ key: "-", ctrlKey: true });
    press({ key: "-", ctrlKey: true });
    expect(readPrefs().zoom).toBeCloseTo(start - 0.1);

    press({ key: "0", ctrlKey: true });
    expect(readPrefs().zoom).toBe(1);
  });

  it("ignores key presses without ctrl/meta", () => {
    render(<Probe />);
    const start = readPrefs().zoom;
    press({ key: "=" });
    expect(readPrefs().zoom).toBe(start);
  });
});
