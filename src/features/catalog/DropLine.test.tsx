import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { DropLine } from "./DropLine";

describe("DropLine", () => {
  it("renders a before-line flagged with data-drop-line=before at the top edge", () => {
    render(<DropLine zone="before" />);
    const line = document.querySelector("[data-drop-line='before']");
    expect(line).not.toBeNull();
    expect(line!.getAttribute("aria-hidden")).toBe("true");
    expect(line!.className).toContain("top-0");
  });

  it("renders an after-line at the bottom edge", () => {
    render(<DropLine zone="after" />);
    const line = document.querySelector("[data-drop-line='after']");
    expect(line).not.toBeNull();
    expect(line!.className).toContain("bottom-0");
  });
});
