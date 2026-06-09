import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { UnderlineTabs } from "./underline-tabs";

const items = [
  { value: "a", label: "Alpha" },
  { value: "b", label: "Beta" },
] as const;

describe("UnderlineTabs", () => {
  it("renders exactly one sliding indicator", () => {
    render(<UnderlineTabs value="a" onChange={() => {}} items={items} />);
    expect(screen.getAllByTestId("tab-indicator")).toHaveLength(1);
  });

  it("marks the active tab with aria-selected", () => {
    render(<UnderlineTabs value="a" onChange={() => {}} items={items} />);
    expect(screen.getByRole("tab", { name: "Alpha" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("tab", { name: "Beta" }).getAttribute("aria-selected")).toBe("false");
  });

  it("fires onChange with the clicked tab value", () => {
    const onChange = vi.fn();
    render(<UnderlineTabs value="a" onChange={onChange} items={items} />);
    fireEvent.click(screen.getByRole("tab", { name: "Beta" }));
    expect(onChange).toHaveBeenCalledWith("b");
  });

  it("moves aria-selected when the value changes", () => {
    const { rerender } = render(<UnderlineTabs value="a" onChange={() => {}} items={items} />);
    rerender(<UnderlineTabs value="b" onChange={() => {}} items={items} />);
    expect(screen.getByRole("tab", { name: "Beta" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getAllByTestId("tab-indicator")).toHaveLength(1);
  });

  it("hides the indicator while busy (progress bar owns the underline)", () => {
    render(<UnderlineTabs value="a" onChange={() => {}} items={items} busy />);
    expect(screen.getByTestId("tab-indicator").style.opacity).toBe("0");
  });
});
