import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

// vi.hoisted ensures the variable is initialized before the mock factory runs,
// avoiding TDZ errors from transitive imports that evaluate isMacOS at module load.
const { mockIsMacOS } = vi.hoisted(() => ({ mockIsMacOS: { value: false } }));

vi.mock("@/lib/platform", () => ({
  get isMacOS() {
    return mockIsMacOS.value;
  },
}));

import { KeyboardPane } from "./KeyboardPane";

describe("KeyboardPane", () => {
  it("lists the Split direction shortcut with Alt+V on Windows/Linux", () => {
    mockIsMacOS.value = false;
    render(<KeyboardPane />);
    expect(screen.getByText("Split direction")).toBeInTheDocument();
    // chord glyphs render as <Kbd> with text "Alt" and "V"
    expect(screen.getAllByText("V").length).toBeGreaterThan(0);
  });
});
