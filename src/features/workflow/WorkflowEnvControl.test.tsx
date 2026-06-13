import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, act, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@/ipc/client", () => ({
  // The control loads envs on mount; the store's setWorkflowEnv syncs the backend.
  envList: vi.fn().mockResolvedValue([
    { name: "staging", variables: {}, color: null },
    { name: "prod", variables: {}, color: null },
  ]),
  envActiveSet: vi.fn().mockResolvedValue(undefined),
  envReorder: vi.fn().mockResolvedValue(undefined),
}));

import { WorkflowEnvControl } from "./WorkflowEnvControl";
import { workflowStore } from "./store";
import { envList, envReorder } from "@/ipc/client";

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

  it("drag-reordering env rows calls envReorder and reorders optimistically", async () => {
    const user = userEvent.setup();
    render(<WorkflowEnvControl />);
    await user.click(await screen.findByText("No environment")); // open the menu
    const stagingRow = (await screen.findByText("staging")).closest("[data-env-row]")!;
    const prodRow = screen.getByText("prod").closest("[data-env-row]")!;
    fireEvent.dragStart(stagingRow);
    fireEvent.dragOver(prodRow, { clientY: 5 }); // zero-size jsdom rect ⇒ "after"
    fireEvent.drop(prodRow, { clientY: 5 });
    expect(envReorder).toHaveBeenCalledWith(["prod", "staging"]);
    // Optimistic local order: prod row now precedes staging row.
    const rows = Array.from(document.querySelectorAll("[data-env-row]")).map((r) =>
      r.getAttribute("data-env-row"),
    );
    expect(rows).toEqual(["prod", "staging"]);
  });

  it("snaps back to the backend order when envReorder fails", async () => {
    const user = userEvent.setup();
    vi.mocked(envReorder).mockRejectedValueOnce(new Error("boom"));
    // Clear call history so we can assert mount + snap-back refetch count cleanly.
    vi.mocked(envList).mockClear();
    render(<WorkflowEnvControl />);
    await user.click(await screen.findByText("No environment"));
    const stagingRow = (await screen.findByText("staging")).closest("[data-env-row]")!;
    const prodRow = screen.getByText("prod").closest("[data-env-row]")!;
    fireEvent.dragStart(stagingRow);
    fireEvent.dragOver(prodRow, { clientY: 5 }); // zero-size jsdom rect ⇒ "after"
    fireEvent.drop(prodRow, { clientY: 5 });
    await waitFor(() => {
      const rows = Array.from(document.querySelectorAll("[data-env-row]")).map((r) =>
        r.getAttribute("data-env-row"),
      );
      // Backend returned ["staging", "prod"] (unchanged mock), so after snap-back
      // the rows must restore to that order.
      expect(rows).toEqual(["staging", "prod"]);
    });
    // mount call + snap-back refetch = at least 2 envList calls
    expect(vi.mocked(envList).mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it("Ctrl+E cycles the active workflow env, excluding 'No environment'", async () => {
    render(<WorkflowEnvControl />);
    await screen.findByText("No environment");
    // Flush the on-mount envList() resolution so `envs` state is populated and
    // the hotkey effect has re-bound with the real env list.
    await act(async () => {});

    const pressCtrlE = () =>
      act(() => {
        window.dispatchEvent(
          new KeyboardEvent("keydown", { code: "KeyE", ctrlKey: true, bubbles: true }),
        );
      });

    pressCtrlE(); // null → first
    expect(workflowStore.activeWorkflow().envName).toBe("staging");
    pressCtrlE(); // staging → prod
    expect(workflowStore.activeWorkflow().envName).toBe("prod");
    pressCtrlE(); // prod → wrap → staging
    expect(workflowStore.activeWorkflow().envName).toBe("staging");
  });

  it("ignores AltGr+E (Ctrl+Alt = symbol on EU layouts) — env unchanged", async () => {
    render(<WorkflowEnvControl />);
    await screen.findByText("No environment");
    await act(async () => {});

    act(() => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", { code: "KeyE", ctrlKey: true, altKey: true, bubbles: true }),
      );
    });

    expect(workflowStore.activeWorkflow().envName).toBeNull();
  });
});
