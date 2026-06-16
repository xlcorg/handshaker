import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { ImportSummaryDialog } from "./ImportSummaryDialog";

const summary = { collections_total: 3, collections_existing: 1, environments_total: 2, environments_existing: 1 };

describe("ImportSummaryDialog", () => {
  it("shows totals and how many will be updated, nothing deleted", () => {
    render(
      <ImportSummaryDialog open summary={summary} onConfirm={vi.fn()} onCancel={vi.fn()} />,
    );
    expect(screen.getByText(/3 collections/i)).toBeInTheDocument();
    expect(screen.getByText(/2 environments/i)).toBeInTheDocument();
    expect(screen.getByText(/updated/i)).toBeInTheDocument();
    expect(screen.getByText(/nothing is deleted/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^import$/i })).toBeInTheDocument();
  });

  it("fires onConfirm when Import is clicked", async () => {
    const onConfirm = vi.fn();
    render(<ImportSummaryDialog open summary={summary} onConfirm={onConfirm} onCancel={vi.fn()} />);
    screen.getByRole("button", { name: /^import$/i }).click();
    expect(onConfirm).toHaveBeenCalled();
  });
});
