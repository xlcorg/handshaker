import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

const check = vi.fn();
const relaunch = vi.fn();
vi.mock("@tauri-apps/plugin-updater", () => ({ check: () => check() }));
vi.mock("@tauri-apps/plugin-process", () => ({ relaunch: () => relaunch() }));

import { useUpdateCheck } from "./useUpdateCheck";

beforeEach(() => {
  vi.clearAllMocks();
});

function fakeUpdate(over: Partial<{ version: string; downloadAndInstall: (cb: (e: any) => void) => Promise<void> }> = {}) {
  return {
    version: "0.2.0",
    downloadAndInstall: vi.fn(async () => {}),
    ...over,
  };
}

describe("useUpdateCheck", () => {
  it("starts checking, then exposes an available update", async () => {
    check.mockResolvedValue(fakeUpdate());
    const { result } = renderHook(() => useUpdateCheck());
    await waitFor(() => expect(result.current.phase).toBe("available"));
    expect(result.current.version).toBe("0.2.0");
  });

  it("reports upToDate when check returns null", async () => {
    check.mockResolvedValue(null);
    const { result } = renderHook(() => useUpdateCheck());
    await waitFor(() => expect(result.current.phase).toBe("upToDate"));
  });

  it("swallows a check error into the error phase (no throw)", async () => {
    check.mockRejectedValue(new Error("not running in tauri"));
    const { result } = renderHook(() => useUpdateCheck());
    await waitFor(() => expect(result.current.phase).toBe("error"));
  });

  it("install() downloads (updating progress) then relaunches", async () => {
    const downloadAndInstall = vi.fn(async (cb: (e: any) => void) => {
      cb({ event: "Started", data: { contentLength: 100 } });
      cb({ event: "Progress", data: { chunkLength: 50 } });
      cb({ event: "Progress", data: { chunkLength: 50 } });
      cb({ event: "Finished" });
    });
    check.mockResolvedValue(fakeUpdate({ downloadAndInstall }));
    const { result } = renderHook(() => useUpdateCheck());
    await waitFor(() => expect(result.current.phase).toBe("available"));
    await act(async () => {
      await result.current.install();
    });
    expect(downloadAndInstall).toHaveBeenCalledTimes(1);
    expect(relaunch).toHaveBeenCalledTimes(1);
  });

  it("dismiss() hides the banner", async () => {
    check.mockResolvedValue(fakeUpdate());
    const { result } = renderHook(() => useUpdateCheck());
    await waitFor(() => expect(result.current.phase).toBe("available"));
    act(() => result.current.dismiss());
    expect(result.current.phase).toBe("idle");
  });
});
