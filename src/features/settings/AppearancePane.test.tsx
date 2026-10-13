import { describe, it, expect } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AppearancePane } from "./AppearancePane";
import { readPrefs } from "@/lib/use-prefs";

describe("AppearancePane zoom row", () => {
  it("steps zoom by 10% and resets", async () => {
    const user = userEvent.setup();
    render(<AppearancePane />);
    // default 100%, Reset hidden
    expect(screen.getByText("100%")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Reset zoom" })).toBeNull();

    await user.click(screen.getByRole("button", { name: "Zoom in" }));
    expect(screen.getByText("110%")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Reset zoom" }));
    expect(screen.getByText("100%")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Zoom out" }));
    expect(screen.getByText("90%")).toBeInTheDocument();
    // restore default so it doesn't leak into sibling tests
    await user.click(screen.getByRole("button", { name: "Reset zoom" }));
  });
});

describe("AppearancePane", () => {
  it("shows Zoom and no gRPC icon row", () => {
    render(<AppearancePane />);
    expect(screen.getByText("Zoom")).toHaveTextContent("Zoom");
    expect(screen.queryByText("gRPC icon")).not.toBeInTheDocument();
  });

  it("method list style dropdown updates the pref", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    render(<AppearancePane />);
    await user.click(screen.getByLabelText("method-list-style"));
    await user.click(screen.getByText("Tree"));
    expect(readPrefs().methodGroupStyle).toBe("tree");
  });

  it("variable highlight scheme dropdown updates the pref", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    render(<AppearancePane />);
    await user.click(screen.getByLabelText("var-highlight-scheme"));
    await user.click(screen.getByText("Amber"));
    expect(readPrefs().varHighlight).toBe("amber");
  });

  it("word wrap switch toggles the pref", () => {
    render(<AppearancePane />);
    const row = screen.getByText("Word wrap").closest("div.flex") as HTMLElement;
    const toggle = () => fireEvent.click(within(row).getByRole("switch"));
    if (readPrefs().wordWrap) toggle();
    expect(readPrefs().wordWrap).toBe(false);
    toggle();
    expect(readPrefs().wordWrap).toBe(true);
    toggle();
    expect(readPrefs().wordWrap).toBe(false);
  });
});
