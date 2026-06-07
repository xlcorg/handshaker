import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { PinButton } from "./PinButton";

describe("PinButton", () => {
  it("reflects pinned state via aria-pressed and label", () => {
    const { rerender } = render(<PinButton pinned={false} onToggle={() => {}} />);
    expect(screen.getByLabelText("pin-collection").getAttribute("aria-pressed")).toBe("false");
    rerender(<PinButton pinned onToggle={() => {}} />);
    expect(screen.getByLabelText("unpin-collection").getAttribute("aria-pressed")).toBe("true");
  });

  it("reflects toggled state via Radix data-state", () => {
    const { rerender } = render(<PinButton pinned={false} onToggle={() => {}} />);
    expect(screen.getByLabelText("pin-collection").getAttribute("data-state")).toBe("off");
    rerender(<PinButton pinned onToggle={() => {}} />);
    expect(screen.getByLabelText("unpin-collection").getAttribute("data-state")).toBe("on");
  });

  it("preserves hover-reveal visibility classes", () => {
    const { rerender } = render(<PinButton pinned={false} onToggle={() => {}} />);
    expect(screen.getByLabelText("pin-collection").className).toContain("opacity-0");
    rerender(<PinButton pinned onToggle={() => {}} />);
    expect(screen.getByLabelText("unpin-collection").className).toContain("opacity-100");
  });

  it("fires onToggle on click", () => {
    const onToggle = vi.fn();
    render(<PinButton pinned={false} onToggle={onToggle} />);
    fireEvent.click(screen.getByLabelText("pin-collection"));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });
});
