import { describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { workflowStore } from "./store";
import { ViewSwitcher } from "./ViewSwitcher";

beforeEach(() => workflowStore.reset());

describe("ViewSwitcher", () => {
  it("offers the three modes and reflects the active one", () => {
    render(<ViewSwitcher />);
    expect(screen.getByRole("radio", { name: "Лента" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Список" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Фокус" })).toBeInTheDocument();
  });

  it("switching updates the active workflow's view", async () => {
    const user = userEvent.setup();
    render(<ViewSwitcher />);
    await user.click(screen.getByRole("radio", { name: "Список" }));
    expect(workflowStore.activeWorkflow().view).toBe("list");
  });
});
