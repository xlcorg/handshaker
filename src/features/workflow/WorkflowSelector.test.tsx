import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { workflowStore } from "./store";
import { WorkflowSelector } from "./WorkflowSelector";

beforeEach(() => workflowStore.reset());

describe("WorkflowSelector", () => {
  it("shows the active workflow name in the trigger", () => {
    render(<WorkflowSelector />);
    expect(screen.getByRole("button", { name: /workflow-1/ })).toBeInTheDocument();
  });

  it("re-renders when the active workflow changes", () => {
    render(<WorkflowSelector />);
    act(() => { workflowStore.createWorkflow("incident-42"); });
    expect(screen.getByRole("button", { name: /incident-42/ })).toBeInTheDocument();
  });
});
