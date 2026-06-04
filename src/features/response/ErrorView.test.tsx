import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ErrorView } from "./ErrorView";
import type { InvokeOutcomeIpc } from "@/ipc/bindings";

const outcome = (over: Partial<InvokeOutcomeIpc> = {}): InvokeOutcomeIpc => ({
  status_code: 5,
  status_message: "NOT_FOUND: user does not exist",
  response_json: null,
  trailing_metadata: {},
  elapsed_ms: 12,
  ...over,
});

describe("ErrorView", () => {
  it("renders the status code name and the message prominently", () => {
    render(<ErrorView outcome={outcome()} />);
    expect(screen.getByText("NOT_FOUND")).toBeInTheDocument();
    expect(screen.getByText(/user does not exist/)).toBeInTheDocument();
  });
  it("notes that structured google.rpc details are unavailable (backend pending)", () => {
    render(<ErrorView outcome={outcome()} />);
    expect(screen.getByText("details")).toBeInTheDocument();
  });
});
