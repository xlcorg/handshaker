import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { KeyboardPane } from "./KeyboardPane";

describe("KeyboardPane", () => {
  it("lists the Word wrap → Alt+Z shortcut", () => {
    render(<KeyboardPane />);
    // Scope to the Word wrap row so the assertion can't be confused by another
    // shortcut adopting "Alt" or "Z" as ROWS grows.
    const row = screen.getByText("Word wrap").closest("div.flex") as HTMLElement;
    expect(within(row).getByText("Alt")).toBeInTheDocument();
    expect(within(row).getByText("Z")).toBeInTheDocument();
  });

  it("lists the Split direction → Alt+V shortcut", () => {
    render(<KeyboardPane />);
    const row = screen.getByText("Split direction").closest("div.flex") as HTMLElement;
    expect(within(row).getByText("Alt")).toBeInTheDocument();
    expect(within(row).getByText("V")).toBeInTheDocument();
  });
});
