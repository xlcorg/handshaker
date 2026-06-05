import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MethodPicker } from "./MethodPicker";
import type { SelectedMethod } from "./SelectedMethod";

const empty: SelectedMethod = { service: "", method: "", kind: "unary" };

describe("MethodPicker trigger", () => {
  it("shows the 'Select a method' placeholder when nothing is selected", () => {
    render(<MethodPicker selected={empty} catalog={null} onSelect={vi.fn()} />);
    expect(screen.getByText("Select a method")).toBeInTheDocument();
  });

  it("shows the method name when a method is selected (even without catalog)", () => {
    render(
      <MethodPicker
        selected={{ service: "p.v1.S", method: "GetX", kind: "unary" }}
        catalog={null}
        onSelect={vi.fn()}
      />,
    );
    expect(screen.getByText("GetX")).toBeInTheDocument();
  });
});
