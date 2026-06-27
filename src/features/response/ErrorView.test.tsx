import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ErrorView } from "./ErrorView";
import type { InvokeOutcomeIpc } from "@/ipc/bindings";

const outcome = (over: Partial<InvokeOutcomeIpc> = {}): InvokeOutcomeIpc => ({
  status_code: 5,
  status_message: "user does not exist",
  response_json: null,
  trailing_metadata: {},
  status_details: [],
  elapsed_ms: 12,
  ...over,
});

describe("ErrorView", () => {
  it("renders the server's raw status message, not the code/name (those live in the panel summary)", () => {
    render(<ErrorView outcome={outcome()} />);
    expect(screen.getByText(/user does not exist/)).toBeInTheDocument();
    // Status code and name are owned by RespMeta; ErrorView must not repeat them.
    expect(screen.queryByText("NOT_FOUND")).not.toBeInTheDocument();
    expect(screen.queryByText("5")).not.toBeInTheDocument();
  });

  it("renders structured details when present, and drops the no-details note", () => {
    render(
      <ErrorView
        outcome={outcome({
          status_details: [{ type: "ErrorInfo", reason: "STOCKOUT", domain: "shop", metadata: {} }],
        })}
      />,
    );
    expect(screen.getByText("STOCKOUT")).toBeInTheDocument();
    expect(screen.queryByText(/no google\.rpc details/i)).not.toBeInTheDocument();
  });

  it("shows a muted 'no details' note only when there are none", () => {
    render(<ErrorView outcome={outcome()} />);
    expect(screen.getByText(/no google\.rpc details/i)).toBeInTheDocument();
  });
});
