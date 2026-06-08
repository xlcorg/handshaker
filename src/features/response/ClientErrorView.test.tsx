import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ClientErrorView } from "./ClientErrorView";

describe("ClientErrorView", () => {
  it("shows the raw message", () => {
    render(<ClientErrorView message="connect `http://localhost:50023`: transport error" />);
    expect(screen.getByText(/transport error/i)).toBeInTheDocument();
  });

  it("renders a diagnostic hint for a recognised transport error", () => {
    render(<ClientErrorView message="connection refused" />);
    expect(screen.getByTestId("diag-hint")).toBeInTheDocument();
    expect(screen.getByText(/listening|reachable|server is running/i)).toBeInTheDocument();
  });

  it("shows no hint for an unrecognised (other) message", () => {
    render(<ClientErrorView message="Unresolved variables: {{host}}" />);
    expect(screen.queryByTestId("diag-hint")).not.toBeInTheDocument();
  });
});
