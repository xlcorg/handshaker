import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";

const isFullscreen = vi.fn();
const onResized = vi.fn();
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ isFullscreen, onResized }),
}));

import { useIsFullscreen } from "./use-fullscreen";

beforeEach(() => {
  vi.clearAllMocks();
  isFullscreen.mockResolvedValue(false);
  onResized.mockResolvedValue(() => {});
});

describe("useIsFullscreen", () => {
  it("reports the initial fullscreen state", async () => {
    isFullscreen.mockResolvedValue(true);
    const { result } = renderHook(() => useIsFullscreen());
    await waitFor(() => expect(result.current).toBe(true));
  });

  it("re-queries fullscreen on resize", async () => {
    isFullscreen.mockResolvedValue(false);
    let resizeCb: () => void = () => {};
    onResized.mockImplementation((cb: () => void) => {
      resizeCb = cb;
      return Promise.resolve(() => {});
    });
    const { result } = renderHook(() => useIsFullscreen());
    await waitFor(() => expect(result.current).toBe(false));

    isFullscreen.mockResolvedValue(true);
    resizeCb();
    await waitFor(() => expect(result.current).toBe(true));
  });
});
