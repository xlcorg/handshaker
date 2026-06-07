import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Alert, AlertDescription } from "./alert";

describe("Alert", () => {
  it("renders a role=alert element with data-slot=alert", () => {
    render(<Alert>hello</Alert>);
    const el = screen.getByRole("alert");
    expect(el.getAttribute("data-slot")).toBe("alert");
  });

  it("applies the destructive variant class", () => {
    render(<Alert variant="destructive">boom</Alert>);
    const el = screen.getByRole("alert");
    expect(el.className).toContain("text-destructive");
  });

  it("renders children (AlertDescription text)", () => {
    render(
      <Alert variant="destructive">
        <AlertDescription>something failed</AlertDescription>
      </Alert>,
    );
    expect(screen.getByText("something failed")).toBeTruthy();
  });
});
