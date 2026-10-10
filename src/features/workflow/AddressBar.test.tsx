import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { AddressBar } from "./AddressBar";
import { newStep, type Step } from "./model";
import { TooltipProvider } from "@/components/ui/tooltip";
import { streamStore } from "@/features/stream/streamStore";
import { messages } from "@/lib/messages";

const base = newStep({ address: "h:443", tls: true, service: "S", method: "M" });

function renderBar(step: Step, handlers: { onSend?: () => void; onCancel?: () => void } = {}) {
  return render(
    <TooltipProvider>
      <AddressBar step={step} kind={null} onSend={handlers.onSend ?? (() => {})} onCancel={handlers.onCancel ?? (() => {})} />
    </TooltipProvider>,
  );
}

describe("AddressBar cancel", () => {
  it("shows Send (not Cancel) when idle", () => {
    renderBar(base);
    expect(screen.getByRole("button", { name: /send/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /cancel/i })).not.toBeInTheDocument();
  });

  it("keeps Send during the busy gate, then swaps to Cancel and calls onCancel", () => {
    vi.useFakeTimers();
    try {
      const onCancel = vi.fn();
      renderBar({ ...base, status: "sending" }, { onCancel });
      // Gated: a sub-250ms call never flips to Cancel.
      expect(screen.getByRole("button", { name: /send/i })).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /cancel/i })).not.toBeInTheDocument();
      act(() => vi.advanceTimersByTime(250));
      expect(screen.queryByRole("button", { name: /send/i })).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
      expect(onCancel).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("AddressBar status chip for stream snapshots", () => {
  const end = (code: number) => ({ type: "End" as const, status_code: code, status_message: "", status_details: [], trailing_metadata: {}, elapsed_ms: 5, message_count: 1, total_bytes: 2 });

  it("End OK → ✓ OK chip (a stream snapshot is not a draft)", () => {
    streamStore.reset();
    streamStore.open("s1", "server", Date.now());
    streamStore.push("s1", end(0));
    renderBar({ ...base, status: "ok", streamId: "s1" });
    expect(screen.getByText(/^✓ OK · /)).toBeInTheDocument();
  });

  it("End non-OK → ✕ <code> <NAME>", () => {
    streamStore.reset();
    streamStore.open("s1", "server", Date.now());
    streamStore.push("s1", end(5));
    renderBar({ ...base, status: "error", streamId: "s1" });
    expect(screen.getByText("✕ 5 NOT_FOUND")).toBeInTheDocument();
  });

  it("Cancelled → ○ Cancelled", () => {
    streamStore.reset();
    streamStore.open("s1", "client", Date.now());
    streamStore.cancel("s1");
    renderBar({ ...base, status: "cancelled", streamId: "s1" });
    expect(screen.getByText(messages.workflow.addressBar.chip.cancelled)).toBeInTheDocument();
  });

  it("shows no kind badge even for a stream snapshot", () => {
    streamStore.reset();
    streamStore.open("s1", "client", Date.now());
    streamStore.push("s1", end(0));
    renderBar({ ...base, status: "ok", streamId: "s1" });
    expect(screen.queryByText(messages.methodKind.badge.client)).toBeNull();
  });
});
