import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { VarSuggestDropdown } from "./VarSuggestDropdown";
import type { VarCandidate } from "./candidates";

const items: VarCandidate[] = [
  { name: "host", value: "api.staging", origin: "env", overrides: true },
  { name: "order_id", value: "42", origin: "collection" },
];

describe("VarSuggestDropdown", () => {
  it("renders a listbox with option rows showing name, value and origin", () => {
    render(<VarSuggestDropdown items={items} active={0} listboxId="lb" onPick={() => {}} left={0} />);
    expect(screen.getByRole("listbox")).toBeInTheDocument();
    const opts = screen.getAllByRole("option");
    expect(opts).toHaveLength(2);
    expect(opts[0]).toHaveAttribute("aria-selected", "true");
    expect(opts[0]).toHaveTextContent("host");
    expect(opts[0]).toHaveTextContent("api.staging");
    expect(screen.getByText("env")).toBeInTheDocument();
    expect(screen.getByText("collection")).toBeInTheDocument();
  });

  it("calls onPick with the index on mousedown", () => {
    const onPick = vi.fn();
    render(<VarSuggestDropdown items={items} active={0} listboxId="lb" onPick={onPick} left={0} />);
    // mousedown (not click) so the input keeps focus
    screen.getAllByRole("option")[1].dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    expect(onPick).toHaveBeenCalledWith(1);
  });
});
