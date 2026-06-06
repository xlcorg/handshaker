import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { Toaster } from "./toaster";
import { toast, toastStore } from "@/lib/toast";

beforeEach(() => { toastStore.reset(); vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe("Toaster", () => {
  it("renders active toasts and auto-dismisses them after the timeout", () => {
    render(<Toaster />);
    act(() => { toast("Copied"); });
    expect(screen.getByText("Copied")).toBeInTheDocument();
    act(() => { vi.advanceTimersByTime(2000); });
    expect(screen.queryByText("Copied")).not.toBeInTheDocument();
  });

  it("styles an error toast with the destructive class and an alert role", () => {
    render(<Toaster />);
    act(() => { toast("boom", "error"); });
    const row = screen.getByText("boom").closest("[role='alert']");
    expect(row).not.toBeNull();
    expect(row!.className).toContain("bg-destructive");
  });

  it("renders a success toast with the neutral pill (no destructive class)", () => {
    render(<Toaster />);
    act(() => { toast("Saved", "success"); });
    const row = screen.getByText("Saved").closest("div");
    expect(row!.className).toContain("bg-foreground");
    expect(row!.className).not.toContain("bg-destructive");
  });
});
