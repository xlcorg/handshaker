import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { workflowStore } from "./store";
import { addStep } from "./reducers";
import { newStep } from "./model";
import { StepList } from "./StepList";

function seed(...methods: string[]) {
  for (const m of methods) {
    workflowStore.update((w) =>
      addStep(w, newStep({ address: "h", tls: true, service: "p.v1.S", method: m })),
    );
  }
}

beforeEach(() => workflowStore.reset());

describe("StepList", () => {
  it("renders one row per step", () => {
    seed("A", "B", "C");
    render(<StepList />);
    expect(screen.getAllByRole("listitem")).toHaveLength(3);
  });

  it("selecting a row sets it active in the store", async () => {
    const user = userEvent.setup();
    seed("A", "B");
    const firstId = workflowStore.activeWorkflow().steps[0].id;
    render(<StepList />);
    await user.click(screen.getByText(/S · A/));
    expect(workflowStore.activeWorkflow().activeStepId).toBe(firstId);
  });

  it("deleting a row removes it from the store", async () => {
    const user = userEvent.setup();
    seed("A", "B");
    render(<StepList />);
    const rows = screen.getAllByRole("listitem");
    const delBtn = rows[0].querySelector("button")!;
    await user.click(delBtn);
    expect(workflowStore.activeWorkflow().steps.map((s) => s.method)).toEqual(["B"]);
  });

  it("dropping row 2 onto row 0 reorders via reducer", () => {
    seed("A", "B", "C");
    render(<StepList />);
    const rows = screen.getAllByRole("listitem");
    const dt = {
      _s: {} as Record<string, string>,
      effectAllowed: "",
      setData(k: string, v: string) {
        this._s[k] = v;
      },
      getData(k: string) {
        return this._s[k] ?? "";
      },
    };
    fireEvent.dragStart(rows[2], { dataTransfer: dt });
    fireEvent.drop(rows[0], { dataTransfer: dt });
    expect(workflowStore.activeWorkflow().steps.map((s) => s.method)).toEqual(["C", "A", "B"]);
  });
});
