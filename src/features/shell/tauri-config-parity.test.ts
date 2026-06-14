import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";

// vitest runs with the repo root as cwd.
const base = JSON.parse(readFileSync("src-tauri/tauri.conf.json", "utf8"));
const mac = JSON.parse(readFileSync("src-tauri/tauri.macos.conf.json", "utf8"));

const baseWin = base.app.windows[0];
const macWin = mac.app.windows[0];

describe("tauri.macos.conf.json", () => {
  it("enables native traffic lights via Overlay", () => {
    expect(macWin.decorations).toBe(true);
    expect(macWin.titleBarStyle).toBe("Overlay");
    expect(macWin.trafficLightPosition).toBeTruthy();
  });

  // RFC 7396 replaces arrays wholesale, so the macOS window object must repeat
  // every geometry field from the base — this guards against drift.
  it("keeps window geometry in sync with the base config", () => {
    const keys = [
      "label", "title", "width", "height", "minWidth",
      "minHeight", "resizable", "fullscreen", "dragDropEnabled",
      "backgroundColor",
    ];
    for (const k of keys) {
      expect(macWin[k]).toEqual(baseWin[k]);
    }
  });
});

describe("tauri.conf.json window background", () => {
  // A dark window+webview background kills the white startup flash before the
  // dark frontend paints (Tauri backgroundColor covers both layers).
  it("sets a dark window background on both configs", () => {
    expect(baseWin.backgroundColor).toBe("#0A0A0A");
    expect(macWin.backgroundColor).toBe("#0A0A0A");
  });
});
