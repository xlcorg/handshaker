import { describe, it, expect, vi, beforeEach } from "vitest";

const setZoom = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: () => ({ setZoom }),
}));

import { zoomActionFromKey, nextZoom, applyZoom } from "./zoom";

beforeEach(() => {
  setZoom.mockReset();
  setZoom.mockResolvedValue(undefined);
});

describe("zoomActionFromKey", () => {
  const ev = (p: Partial<KeyboardEvent>) =>
    ({ key: "", code: "", ctrlKey: false, metaKey: false, ...p }) as KeyboardEvent;

  it("requires ctrl/meta", () => {
    expect(zoomActionFromKey(ev({ key: "=" }))).toBeNull();
    expect(zoomActionFromKey(ev({ key: "=", ctrlKey: true }))).toBe("in");
    expect(zoomActionFromKey(ev({ key: "=", metaKey: true }))).toBe("in");
  });

  it("maps =/+/NumpadAdd to in, -/NumpadSubtract to out, 0/Numpad0 to reset", () => {
    expect(zoomActionFromKey(ev({ key: "+", ctrlKey: true }))).toBe("in");
    expect(zoomActionFromKey(ev({ key: "x", code: "NumpadAdd", ctrlKey: true }))).toBe("in");
    expect(zoomActionFromKey(ev({ key: "-", ctrlKey: true }))).toBe("out");
    expect(zoomActionFromKey(ev({ key: "x", code: "NumpadSubtract", ctrlKey: true }))).toBe("out");
    expect(zoomActionFromKey(ev({ key: "0", ctrlKey: true }))).toBe("reset");
    expect(zoomActionFromKey(ev({ key: "x", code: "Numpad0", ctrlKey: true }))).toBe("reset");
    expect(zoomActionFromKey(ev({ key: "9", ctrlKey: true }))).toBeNull();
  });
});

describe("nextZoom", () => {
  it("steps by 0.1 and clamps to [0.5, 3]", () => {
    expect(nextZoom(1, "in")).toBe(1.1);
    expect(nextZoom(1, "out")).toBe(0.9);
    expect(nextZoom(3, "in")).toBe(3);
    expect(nextZoom(0.5, "out")).toBe(0.5);
  });

  it("reset returns 1", () => {
    expect(nextZoom(2.4, "reset")).toBe(1);
  });
});

describe("applyZoom", () => {
  it("calls webview setZoom with the clamped factor", async () => {
    await applyZoom(1.3);
    expect(setZoom).toHaveBeenCalledWith(1.3);
    await applyZoom(99);
    expect(setZoom).toHaveBeenCalledWith(3);
  });

  it("swallows rejections (outside Tauri)", async () => {
    setZoom.mockRejectedValueOnce(new Error("no ipc"));
    await expect(applyZoom(1)).resolves.toBeUndefined();
  });
});
