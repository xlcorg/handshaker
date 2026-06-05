import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SortControl } from "./SortControl";

describe("SortControl", () => {
  it("fires onChange with the selected sort key", () => {
    const onChange = vi.fn();
    render(<SortControl value="alpha" onChange={onChange} />);
    fireEvent.change(screen.getByLabelText("sort-collections"), { target: { value: "recent" } });
    expect(onChange).toHaveBeenCalledWith("recent");
  });
});
