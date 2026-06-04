import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { Toaster } from "./toaster";
import { toast, toastStore } from "@/lib/toast";

beforeEach(() => { toastStore.reset(); vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe("Toaster", () => {
  it("renders active toasts and auto-dismisses them after the timeout", () => {
    render(<Toaster />);
    act(() => { toast("Скопировано"); });
    expect(screen.getByText("Скопировано")).toBeInTheDocument();
    act(() => { vi.advanceTimersByTime(2000); });
    expect(screen.queryByText("Скопировано")).not.toBeInTheDocument();
  });
});
