import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { newStep } from "./model";
import { StepRow } from "./StepRow";

const step = { ...newStep({ address: "h", tls: true, service: "p.v1.OrderService", method: "GetOrder" }) };

describe("StepRow", () => {
  it("renders number, short title and status", () => {
    render(<StepRow step={step} index={2} active={false} onSelect={() => {}} onDelete={() => {}} />);
    expect(screen.getByText("3")).toBeInTheDocument(); // 1-based
    expect(screen.getByText(/OrderService · GetOrder/)).toBeInTheDocument();
    expect(screen.getByText("draft")).toBeInTheDocument();
  });

  it("selects on row click", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<StepRow step={step} index={0} active={false} onSelect={onSelect} onDelete={() => {}} />);
    await user.click(screen.getByText(/OrderService · GetOrder/));
    expect(onSelect).toHaveBeenCalled();
  });

  it("deletes without selecting (stops propagation)", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    const onDelete = vi.fn();
    render(<StepRow step={step} index={0} active={false} onSelect={onSelect} onDelete={onDelete} />);
    await user.click(screen.getByRole("button", { name: "delete-step" }));
    expect(onDelete).toHaveBeenCalled();
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("marks the active row aria-current", () => {
    render(<StepRow step={step} index={0} active onSelect={() => {}} onDelete={() => {}} />);
    expect(screen.getByRole("listitem")).toHaveAttribute("aria-current", "true");
  });
});
