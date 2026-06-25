import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

const check = vi.fn();
const relaunch = vi.fn();
vi.mock("@tauri-apps/plugin-updater", () => ({ check: (opts: unknown) => check(opts) }));
vi.mock("@tauri-apps/plugin-process", () => ({ relaunch: () => relaunch() }));

import { useUpdateCheck, UPDATE_CHECK_TIMEOUT_MS } from "./useUpdateCheck";

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

  it("bounds the check with a request timeout so a stalled request can't hang until restart", async () => {
    check.mockResolvedValue(null);
    renderHook(() => useUpdateCheck());
    await waitFor(() => expect(check).toHaveBeenCalled());
    expect(check).toHaveBeenCalledWith(
      expect.objectContaining({ timeout: UPDATE_CHECK_TIMEOUT_MS }),
    );
    expect(UPDATE_CHECK_TIMEOUT_MS).toBeGreaterThan(0);
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
    expect(result.current.progress).toBe(100);
  });

  it("install() failure switches to installError (keeping the version) and rethrows", async () => {
    const downloadAndInstall = vi.fn(async () => {
      throw new Error("network down");
    });
    check.mockResolvedValue(fakeUpdate({ downloadAndInstall }));
    const { result } = renderHook(() => useUpdateCheck());
    await waitFor(() => expect(result.current.phase).toBe("available"));
    // Catch the rejection INSIDE act so React still flushes the catch-block state
    // update; a rejection propagating out of act() bails before the flush.
    let caught: unknown;
    await act(async () => {
      caught = await result.current.install().catch((e) => e);
    });
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toBe("network down");
    expect(result.current.phase).toBe("installError");
    expect(result.current.version).toBe("0.2.0");
  });

  it("dismiss() hides the banner", async () => {
    check.mockResolvedValue(fakeUpdate());
    const { result } = renderHook(() => useUpdateCheck());
    await waitFor(() => expect(result.current.phase).toBe("available"));
    act(() => result.current.dismiss());
    expect(result.current.phase).toBe("idle");
  });

  it("recheck() re-runs the check and flags it manual + latches hasUpdate", async () => {
    check.mockResolvedValue(null); // mount → upToDate
    const { result } = renderHook(() => useUpdateCheck());
    await waitFor(() => expect(result.current.phase).toBe("upToDate"));
    expect(result.current.manual).toBe(false);
    expect(result.current.hasUpdate).toBe(false);

    check.mockResolvedValue(fakeUpdate()); // next check → available
    act(() => {
      result.current.recheck();
    });
    await waitFor(() => expect(result.current.phase).toBe("available"));
    expect(result.current.manual).toBe(true);
    expect(result.current.hasUpdate).toBe(true);
  });

  it("dismiss() hides the toast but keeps hasUpdate + version for the titlebar badge", async () => {
    check.mockResolvedValue(fakeUpdate());
    const { result } = renderHook(() => useUpdateCheck());
    await waitFor(() => expect(result.current.phase).toBe("available"));
    act(() => result.current.dismiss());
    expect(result.current.phase).toBe("idle");
    expect(result.current.hasUpdate).toBe(true);
    expect(result.current.version).toBe("0.2.0");
  });

  it("recheck() is a no-op while a download is in flight", async () => {
    let resolveDl: () => void = () => {};
    const downloadAndInstall = vi.fn(
      () => new Promise<void>((res) => { resolveDl = res; }),
    );
    check.mockResolvedValue(fakeUpdate({ downloadAndInstall }));
    const { result } = renderHook(() => useUpdateCheck());
    await waitFor(() => expect(result.current.phase).toBe("available"));

    act(() => {
      void result.current.install();
    });
    await waitFor(() => expect(result.current.phase).toBe("downloading"));

    check.mockClear();
    act(() => {
      result.current.recheck();
    });
    expect(check).not.toHaveBeenCalled();
    resolveDl();
  });
});
