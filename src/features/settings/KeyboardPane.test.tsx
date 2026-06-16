import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { KeyboardPane } from "./KeyboardPane";

describe("KeyboardPane", () => {
  it("lists the Word wrap → Alt+Z shortcut", () => {
    render(<KeyboardPane />);
    expect(screen.getByText("Word wrap")).toBeInTheDocument();
    expect(screen.getByText("Alt")).toBeInTheDocument();
    expect(screen.getByText("Z")).toBeInTheDocument();
  });
});
