import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

vi.mock("@/ipc/client", () => ({
  grpcDescribe: vi.fn(),
  grpcRefreshContract: vi.fn(),
  grpcCancel: vi.fn(),
  varsResolve: vi.fn(),
}));

import * as ipc from "@/ipc/client";
import { useDraftReflection } from "./useDraftReflection";

const cat = { services: [{ full_name: "p.v1.S", methods: [] }] };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(ipc.grpcDescribe).mockResolvedValue(cat as never);
  vi.mocked(ipc.grpcRefreshContract).mockResolvedValue(cat as never);
  vi.mocked(ipc.grpcCancel).mockResolvedValue(undefined as never);
  // Passthrough: address with no vars resolves to itself.
  vi.mocked(ipc.varsResolve).mockImplementation(async (tpl: string) => ({
    resolved: tpl, unresolved_vars: [], cycle_chain: null,
  }));
});
afterEach(() => vi.useRealTimers());

describe("useDraftReflection", () => {
  it("describes ~400ms after the address settles", async () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useDraftReflection("h:443", true));
    expect(ipc.grpcDescribe).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(400); });
    // describe carries a fresh request id (for cancel) + the deadline pref (for timeout).
    expect(ipc.grpcDescribe).toHaveBeenCalledWith(
      { address: "h:443", tls: true, skip_verify: false },
      expect.any(String),
      expect.any(Number),
    );
    expect(result.current.catalog).toEqual(cat);
  });

  it("resolves {{var}} in the address before reflecting (mirrors Send)", async () => {
    vi.useFakeTimers();
    vi.mocked(ipc.varsResolve).mockImplementation(async (tpl: string) => ({
      resolved: tpl.replace("{{host}}", "api.internal"), unresolved_vars: [], cycle_chain: null,
    }));
    renderHook(() => useDraftReflection("{{host}}:443", true));
    await act(async () => { await vi.advanceTimersByTimeAsync(400); });
    expect(ipc.grpcDescribe).toHaveBeenCalledWith(
      { address: "api.internal:443", tls: true, skip_verify: false },
      expect.any(String),
      expect.any(Number),
    );
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

  it("cancel() aborts the in-flight reflection by its request id", async () => {
    // Hang the describe so the request stays in flight long enough to cancel.
    vi.mocked(ipc.grpcDescribe).mockImplementation(() => new Promise(() => {}));
    const { result } = renderHook(() => useDraftReflection("h:443", true));
    await waitFor(() => expect(ipc.grpcDescribe).toHaveBeenCalled());
    const requestId = vi.mocked(ipc.grpcDescribe).mock.calls[0][1];
    expect(typeof requestId).toBe("string");
    act(() => { result.current.cancel(); });
    expect(ipc.grpcCancel).toHaveBeenCalledWith(requestId);
  });

  it("treats a user cancel as quiet — clears loading, sets no error", async () => {
    // The backend cancel Notify rejects the in-flight call with the exact sentinel.
    vi.mocked(ipc.grpcRefreshContract).mockRejectedValue({ message: "request cancelled" });
    const { result } = renderHook(() => useDraftReflection("h:443", false));
    await act(async () => { result.current.refresh(); });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBeNull();
  });
});
