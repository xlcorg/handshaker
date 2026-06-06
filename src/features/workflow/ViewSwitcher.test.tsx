import { describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { workflowStore } from "./store";
import { ViewSwitcher } from "./ViewSwitcher";

beforeEach(() => workflowStore.reset());

describe("ViewSwitcher", () => {
  it("renders English labels Ledger / List / Focus", () => {
    render(<ViewSwitcher />);
    expect(screen.getByRole("radio", { name: "Ledger" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "List" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Focus" })).toBeInTheDocument();
  });

  it("switching updates the active workflow's view", async () => {
    const user = userEvent.setup();
    render(<ViewSwitcher />);
    await user.click(screen.getByRole("radio", { name: "List" }));
    expect(workflowStore.activeWorkflow().view).toBe("list");
  });
});
