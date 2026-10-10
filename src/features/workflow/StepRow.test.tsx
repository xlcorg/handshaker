import { describe, it, expect, vi } from "vitest";
import { Profiler } from "react";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { newStep } from "./model";
import { StepRow } from "./StepRow";
import { streamStore } from "@/features/stream/streamStore";
import { messages } from "@/lib/messages";

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

const endOk = { type: "End" as const, status_code: 0, status_message: "", status_details: [], trailing_metadata: {}, elapsed_ms: 5, message_count: 1, total_bytes: 2 };

describe("StepRow kind badge and stream status", () => {
  it("a stream step shows the badge of the kind it ran as and its End status", () => {
    streamStore.reset();
    streamStore.open("s1", "client", Date.now());
    streamStore.push("s1", endOk);
    const snap = { ...step, status: "ok" as const, streamId: "s1" };
    render(<StepRow step={snap} index={0} active={false} onSelect={() => {}} onDelete={() => {}} />);
    expect(screen.getByText(messages.methodKind.badge.client)).toBeInTheDocument();
    expect(screen.getByText("✓ 0")).toBeInTheDocument();
    expect(screen.queryByText("draft")).toBeNull();
  });

  it("a cancelled stream step reads cancelled", () => {
    streamStore.reset();
    streamStore.open("s1", "server", Date.now());
    streamStore.cancel("s1");
    const snap = { ...step, status: "cancelled" as const, streamId: "s1" };
    render(<StepRow step={snap} index={0} active={false} onSelect={() => {}} onDelete={() => {}} />);
    expect(screen.getByText(messages.methodKind.badge.server)).toBeInTheDocument();
    expect(screen.getByText(messages.workflow.step.cancelled)).toBeInTheDocument();
  });

  it("a unary step shows no badge", () => {
    streamStore.reset();
    const unary = { ...step, status: "ok" as const,
      outcome: { status_code: 0, status_message: "", response_json: "{}", trailing_metadata: {}, status_details: [], elapsed_ms: 1 } };
    render(<StepRow step={unary} index={0} active={false} onSelect={() => {}} onDelete={() => {}} />);
    for (const label of Object.values(messages.methodKind.badge)) expect(screen.queryByText(label)).toBeNull();
  });
});

describe("StepRow subscribes per row", () => {
  it("a message on stream A re-renders only A's row, never B's", () => {
    streamStore.reset();
    streamStore.open("a", "server", Date.now());
    streamStore.open("b", "server", Date.now());
    const stepA = { ...newStep({ address: "h", tls: true, service: "p.v1.S", method: "A" }), status: "sending" as const, streamId: "a" };
    const stepB = { ...newStep({ address: "h", tls: true, service: "p.v1.S", method: "B" }), status: "sending" as const, streamId: "b" };
    const rendersA = vi.fn();
    const rendersB = vi.fn();
    render(
      <>
        <Profiler id="a" onRender={rendersA}>
          <StepRow step={stepA} index={0} active={false} onSelect={() => {}} onDelete={() => {}} />
        </Profiler>
        <Profiler id="b" onRender={rendersB}>
          <StepRow step={stepB} index={1} active={false} onSelect={() => {}} onDelete={() => {}} />
        </Profiler>
      </>,
    );
    rendersA.mockClear();
    rendersB.mockClear();
    // End flushes synchronously — no animation frame to wait for.
    act(() => streamStore.push("a", endOk));
    expect(rendersA).toHaveBeenCalledTimes(1);
    expect(rendersB).not.toHaveBeenCalled();
  });
});
