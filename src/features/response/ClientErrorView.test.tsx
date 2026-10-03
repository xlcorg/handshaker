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

  it("kind_mismatch: the 'Method kind mismatch' title, the remedy hint once, both kinds in the pinned message", () => {
    render(
      <ClientErrorView
        fault={{
          kind: "kind_mismatch",
          message: "pkg.Svc/Watch is server-streaming but was called as unary",
          mismatch: { service: "pkg.Svc", method: "Watch", expected: "unary", actual: "server" },
        }}
      />,
    );
    expect(screen.getByText("Method kind mismatch")).toBeInTheDocument();
    const hint = screen.getByTestId("diag-hint");
    expect(hint.textContent).toMatch(/refresh reflection/i);
    expect(hint.textContent).not.toContain("but was called as");
    // The kinds appear once: in the pinned message, not repeated in the hint.
    expect(screen.getAllByText(/server-streaming/)).toHaveLength(1);
    expect(screen.getByText(/but was called as unary/)).toBeInTheDocument();
  });

  it("shows an auth face for auth faults", () => {
    render(<ClientErrorView fault={{ kind: "auth", message: "no creds" }} />);
    // "Authentication" appears in both the face title and the hint — assert ≥1 match.
    expect(screen.getAllByText(/authentication/i).length).toBeGreaterThan(0);
  });
});
