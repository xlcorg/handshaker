import { describe, it, expect, vi } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { HttpResponsePanel } from "./HttpResponsePanel";

describe("HttpResponsePanel", () => {
  it("shows the tab comet after a short delay, only while sending", () => {
    vi.useFakeTimers();
    try {
      const { rerender } = render(
        <HttpResponsePanel run={{ status: "sending", requestId: "r" }} />,
      );
      expect(screen.queryByTestId("tab-progress")).not.toBeInTheDocument();
      expect(screen.queryByText("Sending…")).not.toBeInTheDocument();
      expect(screen.queryByRole("radiogroup")).not.toBeInTheDocument();

      act(() => {
        vi.advanceTimersByTime(250);
      });
      expect(screen.getByTestId("tab-progress")).toBeInTheDocument();
      expect(screen.queryByText("Sending…")).not.toBeInTheDocument();

      rerender(<HttpResponsePanel run={{ status: "draft" }} />);
      expect(screen.queryByTestId("tab-progress")).not.toBeInTheDocument();
      expect(screen.getByText("Awaiting first request")).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });
});
