import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SortControl } from "./SortControl";

function setup() {
  return userEvent.setup({ pointerEventsCheck: 0 });
}

describe("SortControl", () => {
  it("fires onChange with the selected sort key", async () => {
    const user = setup();
    const onChange = vi.fn();
    render(<SortControl value="alpha" onChange={onChange} />);
    // Open the dropdown by clicking the trigger button
    await user.click(screen.getByLabelText("sort-collections"));
    // Click the "Recent" item
    await user.click(screen.getByText("Recent"));
    expect(onChange).toHaveBeenCalledWith("recent");
  });

  it("marks the active option", async () => {
    const user = setup();
    render(<SortControl value="created" onChange={vi.fn()} />);
    // Open the dropdown
    await user.click(screen.getByLabelText("sort-collections"));
    // The active item should have data-state="checked"
    const createdItem = screen.getByText("Created").closest("[data-slot=dropdown-menu-radio-item]");
    expect(createdItem).not.toBeNull();
    expect(createdItem!.getAttribute("data-state")).toBe("checked");
    // A non-active item should be unchecked
    const nameItem = screen.getByText("Name").closest("[data-slot=dropdown-menu-radio-item]");
    expect(nameItem).not.toBeNull();
    expect(nameItem!.getAttribute("data-state")).toBe("unchecked");
  });
});
