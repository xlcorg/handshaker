import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, act } from "@testing-library/react";

vi.mock("@/ipc/client", () => ({
  // The control loads envs on mount; the store's setWorkflowEnv syncs the backend.
  envList: vi.fn().mockResolvedValue([
    { name: "staging", variables: {} },
    { name: "prod", variables: {} },
  ]),
  envActiveSet: vi.fn().mockResolvedValue(undefined),
}));

import { WorkflowEnvControl } from "./WorkflowEnvControl";
import { workflowStore } from "./store";

beforeEach(() => {
  workflowStore.reset();
});

describe("WorkflowEnvControl", () => {
  it("shows 'No environment' when the active workflow has no env", async () => {
    render(<WorkflowEnvControl />);
    // envList resolves async; the trigger label is independent of it but use
    // findByText to be safe against any async re-render.
    expect(await screen.findByText("No environment")).toBeInTheDocument();
  });

  it("renders the trigger to match WorkflowSelector (no font-mono, text-xs)", async () => {
    render(<WorkflowEnvControl />);
    const label = await screen.findByText("No environment");
    const trigger = label.closest("button");
    expect(trigger).not.toBeNull();
    expect(trigger!.className).not.toContain("font-mono");
    expect(trigger!.className).toContain("text-xs");
  });

  it("re-renders the trigger label when the active workflow's env changes", async () => {
    render(<WorkflowEnvControl />);
    expect(await screen.findByText("No environment")).toBeInTheDocument();

    // Mirror the menu's onActiveSet → store path. radix portals the menu items,
    // so we drive the documented store entry point directly (see GOAL fallback).
    act(() => {
      workflowStore.setWorkflowEnv("prod");
    });

    expect(workflowStore.activeWorkflow().envName).toBe("prod");
    expect(await screen.findByText("prod")).toBeInTheDocument();
  });
});
