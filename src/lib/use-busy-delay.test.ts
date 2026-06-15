import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useBusyDelay } from "./use-busy-delay";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("useBusyDelay", () => {
  it("stays false until the delay elapses, then turns true", () => {
    const { result } = renderHook(() => useBusyDelay(true, 250));
    expect(result.current).toBe(false);
    act(() => vi.advanceTimersByTime(249));
    expect(result.current).toBe(false);
    act(() => vi.advanceTimersByTime(1));
    expect(result.current).toBe(true);
  });

  it("never turns true for a sub-delay burst", () => {
    const { result, rerender } = renderHook(
      ({ a }: { a: boolean }) => useBusyDelay(a, 250),
      { initialProps: { a: true } },
    );
    act(() => vi.advanceTimersByTime(100));
    rerender({ a: false });
    act(() => vi.advanceTimersByTime(500));
    expect(result.current).toBe(false);
  });

  it("resets to false immediately when active goes false", () => {
    const { result, rerender } = renderHook(
      ({ a }: { a: boolean }) => useBusyDelay(a, 250),
      { initialProps: { a: true } },
    );
    act(() => vi.advanceTimersByTime(250));
    expect(result.current).toBe(true);
    rerender({ a: false });
    expect(result.current).toBe(false);
  });

  it("clears the timer on unmount", () => {
    const { unmount } = renderHook(() => useBusyDelay(true, 250));
    unmount();
    expect(() => act(() => vi.advanceTimersByTime(250))).not.toThrow();
  });
});
