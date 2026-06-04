import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { JsonSearchBar } from "./JsonSearchBar";

const base = {
  query: "ber", matchCount: 3, activeIndex: 0,
  onQuery: vi.fn(), onNext: vi.fn(), onPrev: vi.fn(), onClose: vi.fn(),
};

describe("JsonSearchBar", () => {
  it("shows the 1-based active index over the total", () => {
    render(<JsonSearchBar {...base} />);
    expect(screen.getByText("1/3")).toBeInTheDocument();
  });
  it("shows 0/0 when there are no matches", () => {
    render(<JsonSearchBar {...base} matchCount={0} activeIndex={-1} />);
    expect(screen.getByText("0/0")).toBeInTheDocument();
  });
  it("typing calls onQuery; Enter→next, Shift+Enter→prev, Esc→close", async () => {
    const user = userEvent.setup();
    const onQuery = vi.fn(); const onNext = vi.fn(); const onPrev = vi.fn(); const onClose = vi.fn();
    render(<JsonSearchBar {...base} query="" onQuery={onQuery} onNext={onNext} onPrev={onPrev} onClose={onClose} />);
    const input = screen.getByRole("textbox");
    await user.type(input, "x");
    expect(onQuery).toHaveBeenCalledWith("x");
    await user.type(input, "{Enter}");
    expect(onNext).toHaveBeenCalled();
    await user.type(input, "{Shift>}{Enter}{/Shift}");
    expect(onPrev).toHaveBeenCalled();
    await user.type(input, "{Escape}");
    expect(onClose).toHaveBeenCalled();
  });
});
