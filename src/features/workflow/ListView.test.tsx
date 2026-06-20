import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { workflowStore } from "./store";
import { addStep, setActiveStep } from "./reducers";
import { newStep } from "./model";
import { messages } from "@/lib/messages";

vi.mock("./CallPanel", () => ({
  CallPanel: ({ step }: { step: { method: string } }) => (
    <div data-testid="call-panel">{step.method}</div>
  ),
}));

import { ListView } from "./ListView";

beforeEach(() => workflowStore.reset());

describe("ListView", () => {
  it("shows an empty hint with no steps", () => {
    render(<ListView />);
    expect(screen.getByText(messages.workflow.steps.empty)).toBeInTheDocument();
  });

  it("renders the rows and the active step's detail", () => {
    workflowStore.update((w) => addStep(w, newStep({ address: "h", tls: true, service: "p.v1.S", method: "Alpha" })));
    workflowStore.update((w) => addStep(w, newStep({ address: "h", tls: true, service: "p.v1.S", method: "Beta" })));
    render(<ListView />);
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    // addStep made the last step active → its detail shows
    expect(screen.getByTestId("call-panel")).toHaveTextContent("Beta");
  });

  it("prompts to choose when steps exist but none is active", () => {
    workflowStore.update((w) => addStep(w, newStep({ address: "h", tls: true, service: "p.v1.S", method: "Alpha" })));
    workflowStore.update((w) => setActiveStep(w, null));
    render(<ListView />);
    expect(screen.getByText(messages.workflow.list.pickStep)).toBeInTheDocument();
    expect(screen.queryByTestId("call-panel")).not.toBeInTheDocument();
  });
});
