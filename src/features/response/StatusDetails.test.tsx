import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { StatusDetails } from "./StatusDetails";
import type { StatusDetailIpc } from "@/ipc/bindings";

describe("StatusDetails", () => {
  it("renders ErrorInfo reason, domain and metadata", () => {
    const details: StatusDetailIpc[] = [
      { type: "ErrorInfo", reason: "STOCKOUT", domain: "shop.example", metadata: { sku: "X1" } },
    ];
    render(<StatusDetails details={details} />);
    expect(screen.getByText("STOCKOUT")).toBeInTheDocument();
    expect(screen.getByText("shop.example")).toBeInTheDocument();
    expect(screen.getByText("sku")).toBeInTheDocument();
    expect(screen.getByText("X1")).toBeInTheDocument();
  });

  it("renders BadRequest field violations", () => {
    const details: StatusDetailIpc[] = [
      { type: "BadRequest", violations: [{ field: "qty", description: "must be > 0" }] },
    ];
    render(<StatusDetails details={details} />);
    expect(screen.getByText("qty")).toBeInTheDocument();
    expect(screen.getByText("must be > 0")).toBeInTheDocument();
  });

  it("renders RetryInfo suggested delay", () => {
    const details: StatusDetailIpc[] = [{ type: "RetryInfo", retry_delay_ms: 2000 }];
    render(<StatusDetails details={details} />);
    expect(screen.getByText(/retry/i)).toBeInTheDocument();
    expect(screen.getByText(/2(\.0)?\s*s/i)).toBeInTheDocument();
  });

  it("renders Help links", () => {
    const details: StatusDetailIpc[] = [
      { type: "Help", links: [{ description: "Docs", url: "https://example.com/help" }] },
    ];
    render(<StatusDetails details={details} />);
    expect(screen.getByText("Docs")).toBeInTheDocument();
  });
});
