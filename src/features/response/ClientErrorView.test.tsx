import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ClientErrorView } from "./ClientErrorView";

describe("ClientErrorView", () => {
  it("shows the raw message", () => {
    render(<ClientErrorView fault={{ kind: "other", message: "transport error xyz" }} />);
    expect(screen.getByText(/transport error xyz/i)).toBeInTheDocument();
  });

  it("renders a diagnostic hint for a recognised kind", () => {
    render(<ClientErrorView fault={{ kind: "refused", message: "connection refused" }} />);
    expect(screen.getByTestId("diag-hint")).toBeInTheDocument();
    expect(screen.getByText(/listening|server is running/i)).toBeInTheDocument();
  });

  it("shows no hint for the 'other' kind", () => {
    render(<ClientErrorView fault={{ kind: "other", message: "Unresolved variables: {{host}}" }} />);
    expect(screen.queryByTestId("diag-hint")).not.toBeInTheDocument();
  });

  it("shows an auth face for auth faults", () => {
    render(<ClientErrorView fault={{ kind: "auth", message: "no creds" }} />);
    // "Authentication" appears in both the face title and the hint — assert ≥1 match.
    expect(screen.getAllByText(/authentication/i).length).toBeGreaterThan(0);
  });
});
