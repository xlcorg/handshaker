import { describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { workflowStore } from "./store";
import { addStep, setActiveStep } from "./reducers";
import { newStep } from "./model";
import { StepRail } from "./StepRail";

function seed(...methods: string[]) {
  for (const m of methods) {
    workflowStore.update((w) =>
      addStep(w, newStep({ address: "h", tls: true, service: "p.v1.S", method: m })),
    );
  }
}

beforeEach(() => workflowStore.reset());

describe("StepRail", () => {
  it("renders one dot per step", () => {
    seed("A", "B", "C");
    render(<StepRail />);
    expect(screen.getAllByRole("button")).toHaveLength(3);
  });

  it("clicking a dot makes that step active (stays in store)", async () => {
    const user = userEvent.setup();
    seed("A", "B", "C");
    const secondId = workflowStore.activeWorkflow().steps[1].id;
    workflowStore.update((w) => setActiveStep(w, null));
    render(<StepRail />);
    await user.click(screen.getByRole("button", { name: "step-2" }));
    expect(workflowStore.activeWorkflow().activeStepId).toBe(secondId);
  });
});
