import { describe, it, expect, beforeEach, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { workflowStore } from "./store";
import { addStep, setActiveStep } from "./reducers";
import { newStep } from "./model";
import { StepRail } from "./StepRail";
import { streamStore } from "@/features/stream/streamStore";
import { messages } from "@/lib/messages";
import * as stepView from "./stepView";

// Render-count probe: every rail dot summarizes its step once per render.
vi.mock("./stepView", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./stepView")>();
  return { ...actual, summarizeStep: vi.fn(actual.summarizeStep) };
});

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

describe("StepRail per-row stream subscription", () => {
  it("a message on stream A re-summarizes only A's dot, never B's", () => {
    streamStore.reset();
    streamStore.open("a", "server");
    streamStore.open("b", "server");
    workflowStore.update((w) =>
      addStep(w, { ...newStep({ address: "h", tls: true, service: "p.v1.S", method: "A" }), status: "sending", streamId: "a" }),
    );
    workflowStore.update((w) =>
      addStep(w, { ...newStep({ address: "h", tls: true, service: "p.v1.S", method: "B" }), status: "sending", streamId: "b" }),
    );
    const stepAId = workflowStore.activeWorkflow().steps[0].id;
    const summarize = vi.mocked(stepView.summarizeStep);
    render(<StepRail />);
    summarize.mockClear();
    act(() =>
      streamStore.push("a", {
        type: "End", status_code: 0, status_message: "", status_details: [], trailing_metadata: {},
        elapsed_ms: 5, message_count: 1, total_bytes: 2,
      }),
    );
    expect(summarize.mock.calls.map(([s]) => s.id)).toEqual([stepAId]);
  });

  it("titles a dot from the shared message", () => {
    seed("A");
    render(<StepRail />);
    expect(screen.getByRole("button", { name: "step-1" })).toHaveAttribute(
      "title",
      messages.workflow.step.railTitle(1, "S · A", messages.workflow.step.draft),
    );
  });
});
