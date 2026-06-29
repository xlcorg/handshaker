import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Slider } from "./slider";

describe("Slider", () => {
  it("renders a labeled slider thumb", () => {
    render(<Slider thumbLabel="Volume" defaultValue={[4]} min={0} max={11} step={1} />);
    const thumb = screen.getByRole("slider", { name: /volume/i });
    expect(thumb).toBeInTheDocument();
  });
});
