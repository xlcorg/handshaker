import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";

import { VarHighlightInput } from "./VarHighlightInput";

const ok = (resolved: string) => async () => ({ resolved, unresolved_vars: [], cycle_chain: null });
const unresolved = (names: string[]) => async () => ({ resolved: "", unresolved_vars: names, cycle_chain: null });

describe("VarHighlightInput", () => {
  it("renders each {{var}} as its own token span", () => {
    render(<VarHighlightInput value="{{host}}/v1" onChange={() => {}} resolver={ok("x")} ariaLabel="addr" />);
    expect(screen.getByText("{{host}}")).toBeInTheDocument(); // the token segment
    expect(screen.getByText("/v1")).toBeInTheDocument(); // the literal segment
  });

  it("marks a resolved variable green and exposes the full value via the field title", async () => {
    const resolver = vi.fn(ok("localhost:5002"));
    render(<VarHighlightInput value="{{host}}" onChange={() => {}} resolver={resolver} ariaLabel="addr" />);
    await waitFor(() => expect(screen.getByText("{{host}}").className).toContain("emerald"));
    expect(screen.getByLabelText("addr")).toHaveAttribute("title", "localhost:5002");
    expect(resolver).toHaveBeenCalledWith("{{host}}");
  });

  it("marks an unresolved variable as an error", async () => {
    render(
      <VarHighlightInput value="{{host}}" onChange={() => {}} resolver={vi.fn(unresolved(["host"]))} ariaLabel="addr" />,
    );
    await waitFor(() => expect(screen.getByText("{{host}}").className).toContain("destructive"));
    expect(screen.getByLabelText("addr")).toHaveAttribute("title", "Unresolved: host");
  });

  it("does not resolve or set a title when the value has no variables", () => {
    const resolver = vi.fn(ok("x"));
    render(<VarHighlightInput value="host:443" onChange={() => {}} resolver={resolver} ariaLabel="addr" />);
    expect(resolver).not.toHaveBeenCalled();
    expect(screen.getByLabelText("addr")).not.toHaveAttribute("title");
  });

  it("propagates edits through onChange", () => {
    const onChange = vi.fn();
    render(<VarHighlightInput value="" onChange={onChange} ariaLabel="addr" />);
    fireEvent.change(screen.getByLabelText("addr"), { target: { value: "h:1" } });
    expect(onChange).toHaveBeenCalledWith("h:1");
  });
});
