import { describe, it, expect, vi } from "vitest";
import type { ReactElement } from "react";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";

import { TooltipProvider } from "@/components/ui/tooltip";
import { VarHighlightInput } from "./VarHighlightInput";

const ok = (resolved: string) => async () => ({ resolved, unresolved_vars: [], cycle_chain: null });
const unresolved = (names: string[]) => async () => ({ resolved: "", unresolved_vars: names, cycle_chain: null });

// VarHighlightInput renders a Radix Tooltip once a resolve report arrives, so renders
// need a TooltipProvider ancestor (supplied globally in main.tsx).
function r(ui: ReactElement) {
  return render(<TooltipProvider>{ui}</TooltipProvider>);
}

describe("VarHighlightInput", () => {
  it("renders each {{var}} as its own token span", () => {
    r(<VarHighlightInput value="{{host}}/v1" onChange={() => {}} resolver={ok("x")} ariaLabel="addr" />);
    expect(screen.getByText("{{host}}")).toBeInTheDocument(); // the token segment
    expect(screen.getByText("/v1")).toBeInTheDocument(); // the literal segment
  });

  it("marks a resolved variable green and renders the resolved value", async () => {
    const resolver = vi.fn(ok("localhost:5002"));
    r(<VarHighlightInput value="{{host}}" onChange={() => {}} resolver={resolver} ariaLabel="addr" />);
    await waitFor(() => expect(screen.getByText("{{host}}").className).toContain("emerald"));
    expect(screen.getByText("localhost:5002")).toBeInTheDocument(); // inline resolved chip
    expect(resolver).toHaveBeenCalledWith("{{host}}");
  });

  it("marks an unresolved variable as an error and shows no resolved value", async () => {
    r(<VarHighlightInput value="{{host}}" onChange={() => {}} resolver={vi.fn(unresolved(["host"]))} ariaLabel="addr" />);
    await waitFor(() => expect(screen.getByText("{{host}}").className).toContain("destructive"));
    expect(screen.queryByText("localhost:5002")).toBeNull();
  });

  it("does not resolve when the value has no variables", () => {
    const resolver = vi.fn(ok("x"));
    r(<VarHighlightInput value="host:443" onChange={() => {}} resolver={resolver} ariaLabel="addr" />);
    expect(resolver).not.toHaveBeenCalled();
  });

  it("propagates edits through onChange", () => {
    const onChange = vi.fn();
    r(<VarHighlightInput value="" onChange={onChange} ariaLabel="addr" />);
    fireEvent.change(screen.getByLabelText("addr"), { target: { value: "h:1" } });
    expect(onChange).toHaveBeenCalledWith("h:1");
  });
});
