import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

vi.mock("@/ipc/client", () => ({
  grpcDescribe: vi.fn(),
  grpcRefreshContract: vi.fn(),
}));

import * as ipc from "@/ipc/client";
import { useDraftReflection } from "./useDraftReflection";

const cat = { services: [{ full_name: "p.v1.S", methods: [] }] };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(ipc.grpcDescribe).mockResolvedValue(cat as never);
  vi.mocked(ipc.grpcRefreshContract).mockResolvedValue(cat as never);
});
afterEach(() => vi.useRealTimers());

describe("useDraftReflection", () => {
  it("describes ~400ms after the address settles", async () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useDraftReflection("h:443", true));
    expect(ipc.grpcDescribe).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(400); });
    expect(ipc.grpcDescribe).toHaveBeenCalledWith({ address: "h:443", tls: true, skip_verify: false });
    expect(result.current.catalog).toEqual(cat);
  });

  it("does not reflect when the address is empty", async () => {
    vi.useFakeTimers();
    renderHook(() => useDraftReflection("   ", false));
    await act(async () => { await vi.advanceTimersByTimeAsync(400); });
    expect(ipc.grpcDescribe).not.toHaveBeenCalled();
  });

  it("does not reflect when disabled", async () => {
    vi.useFakeTimers();
    renderHook(() => useDraftReflection("h:443", true, false));
    await act(async () => { await vi.advanceTimersByTimeAsync(400); });
    expect(ipc.grpcDescribe).not.toHaveBeenCalled();
  });

  it("refresh() force-refreshes immediately", async () => {
    const { result } = renderHook(() => useDraftReflection("h:443", false));
    await act(async () => { result.current.refresh(); });
    await waitFor(() => expect(ipc.grpcRefreshContract).toHaveBeenCalled());
    expect(result.current.catalog).toEqual(cat);
  });

  it("sets error and clears catalog when reflection rejects", async () => {
    vi.mocked(ipc.grpcRefreshContract).mockRejectedValue({ message: "no reflection" });
    const { result } = renderHook(() => useDraftReflection("h:443", false));
    await act(async () => { result.current.refresh(); });
    await waitFor(() => expect(result.current.error).toBe("no reflection"));
    expect(result.current.catalog).toBeNull();
  });
});
