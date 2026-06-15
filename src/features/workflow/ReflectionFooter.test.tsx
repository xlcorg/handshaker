import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ReflectionFooter } from "./ReflectionFooter";

describe("ReflectionFooter", () => {
  it("shows 'Reflecting…' while loading", () => {
    render(<ReflectionFooter loading error={null} onRefresh={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByText("Reflecting…")).toBeInTheDocument();
  });

  it("offers a cancel button while loading and fires onCancel", () => {
    const onCancel = vi.fn();
    render(<ReflectionFooter loading error={null} onRefresh={vi.fn()} onCancel={onCancel} />);
    fireEvent.click(screen.getByLabelText("Cancel server reflection"));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("shows no cancel button when idle (only refresh)", () => {
    render(<ReflectionFooter loading={false} error={null} onRefresh={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.queryByLabelText("Cancel server reflection")).toBeNull();
  });

  it("shows the error text styled as destructive", () => {
    render(<ReflectionFooter loading={false} error="no reflection here" onRefresh={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByText("no reflection here")).toHaveClass("text-destructive");
  });

  it("offers a retry button on error", () => {
    const onRefresh = vi.fn();
    render(<ReflectionFooter loading={false} error="boom" onRefresh={onRefresh} onCancel={vi.fn()} />);
    fireEvent.click(screen.getByLabelText("Refresh server reflection"));
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it("shows the reflection status and fires refresh", () => {
    const onRefresh = vi.fn();
    render(<ReflectionFooter loading={false} error={null} onRefresh={onRefresh} onCancel={vi.fn()} />);
    expect(screen.getByText("Using server reflection")).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Refresh server reflection"));
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });
});
