import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { workflowStore } from "./store";
import { addStep, setActiveStep } from "./reducers";
import { newStep } from "./model";
import { messages } from "@/lib/messages";

vi.mock("./CallPanel", () => ({
  CallPanel: ({ step }: { step: { method: string } }) => (
    <div data-testid="call-panel">{step.method}</div>
  ),
}));

import { LedgerView } from "./LedgerView";

function seed(...methods: string[]) {
  for (const m of methods) {
    workflowStore.update((w) =>
      addStep(w, newStep({ address: "h", tls: true, service: "p.v1.S", method: m })),
    );
  }
}

beforeEach(() => workflowStore.reset());

describe("LedgerView", () => {
  it("shows an empty hint with no steps", () => {
    render(<LedgerView />);
    expect(screen.getByText(messages.workflow.steps.empty)).toBeInTheDocument();
  });

  it("expands only the active step, collapses the rest", () => {
    seed("Alpha", "Beta", "Gamma"); // Gamma is active (last added)
    render(<LedgerView />);
    // every step has a collapsed row
    expect(screen.getAllByRole("listitem")).toHaveLength(3);
    // exactly one expanded detail, for the active step
    const panels = screen.getAllByTestId("call-panel");
    expect(panels).toHaveLength(1);
    expect(panels[0]).toHaveTextContent("Gamma");
  });

  it("'свернуть все' collapses everything (no expanded detail)", async () => {
    const user = userEvent.setup();
    seed("Alpha", "Beta");
    render(<LedgerView />);
    await user.click(screen.getByRole("button", { name: messages.workflow.steps.collapseAll }));
    expect(workflowStore.activeWorkflow().activeStepId).toBeNull();
    expect(screen.queryByTestId("call-panel")).not.toBeInTheDocument();
  });

  it("clicking a collapsed row expands it", async () => {
    const user = userEvent.setup();
    seed("Alpha", "Beta");
    workflowStore.update((w) => setActiveStep(w, null));
    render(<LedgerView />);
    await user.click(screen.getByText(/S · Alpha/));
    expect(screen.getByTestId("call-panel")).toHaveTextContent("Alpha");
  });
});
