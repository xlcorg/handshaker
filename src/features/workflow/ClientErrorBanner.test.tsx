import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ClientErrorBanner } from "./ClientErrorBanner";

describe("ClientErrorBanner", () => {
  it("shows the raw message", () => {
    render(<ClientErrorBanner message="connection refused" />);
    expect(screen.getByText(/connection refused/i)).toBeInTheDocument();
  });

  it("renders a diagnostic hint for a recognised transport error", () => {
    render(<ClientErrorBanner message="connection refused" />);
    expect(screen.getByText(/listening|reachable|server is running/i)).toBeInTheDocument();
  });

  it("shows no hint for an unrecognised (other) message", () => {
    render(<ClientErrorBanner message="Unresolved variables: {{host}}" />);
    expect(screen.queryByTestId("diag-hint")).not.toBeInTheDocument();
  });
});
