import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { AddressBar } from "./AddressBar";
import { newStep } from "./model";

const base = newStep({ address: "h:443", tls: true, service: "S", method: "M" });

describe("AddressBar cancel", () => {
  it("shows Send (not Cancel) when idle", () => {
    render(<AddressBar step={base} onSend={() => {}} onCancel={() => {}} />);
    expect(screen.getByRole("button", { name: /send/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /cancel/i })).not.toBeInTheDocument();
  });

  it("keeps Send during the busy gate, then swaps to Cancel and calls onCancel", () => {
    vi.useFakeTimers();
    try {
      const onCancel = vi.fn();
      render(<AddressBar step={{ ...base, status: "sending" }} onSend={() => {}} onCancel={onCancel} />);
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
