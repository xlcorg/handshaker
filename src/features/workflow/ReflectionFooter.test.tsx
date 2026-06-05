import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ReflectionFooter } from "./ReflectionFooter";

describe("ReflectionFooter", () => {
  it("shows 'Reflecting…' while loading", () => {
    render(<ReflectionFooter loading error={null} onRefresh={vi.fn()} />);
    expect(screen.getByText("Reflecting…")).toBeInTheDocument();
  });

  it("shows the error text when reflection failed", () => {
    render(<ReflectionFooter loading={false} error="no reflection here" onRefresh={vi.fn()} />);
    expect(screen.getByText("no reflection here")).toBeInTheDocument();
  });

  it("shows the reflection status and fires refresh", () => {
    const onRefresh = vi.fn();
    render(<ReflectionFooter loading={false} error={null} onRefresh={onRefresh} />);
    expect(screen.getByText("Using server reflection")).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("refresh-reflection"));
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });
});
