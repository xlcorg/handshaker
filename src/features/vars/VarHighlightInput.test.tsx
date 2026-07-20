import { describe, it, expect, vi } from "vitest";
import { messages } from "@/lib/messages";
import { useState, type ReactElement } from "react";
import { render, screen, waitFor, fireEvent, act } from "@testing-library/react";
import type { VarCandidate } from "./candidates";

import { TooltipProvider } from "@/components/ui/tooltip";
import { VarHighlightInput } from "./VarHighlightInput";

const ok = (resolved: string) => async () => ({ resolved, unresolved_vars: [], cycle_chain: null, dynamic_vars: [] });
const unresolved = (names: string[]) => async () => ({ resolved: "", unresolved_vars: names, cycle_chain: null, dynamic_vars: [] });

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

  it("marks a resolved variable as resolved and renders the resolved value", async () => {
    const resolver = vi.fn(ok("localhost:5002"));
    r(<VarHighlightInput value="{{host}}" onChange={() => {}} resolver={resolver} ariaLabel="addr" />);
    await waitFor(() => expect(screen.getByText("{{host}}").className).toContain("vh-resolved"));
    expect(screen.getByText("localhost:5002")).toBeInTheDocument(); // inline resolved chip
    expect(resolver).toHaveBeenCalledWith("{{host}}");
  });

  it("recognizes names with non-word chars (dots, slashes, hyphens) like the core grammar", async () => {
    const resolver = vi.fn(ok("https://api.example.com"));
    r(<VarHighlightInput value="{{contracts-info/uri-root}}" onChange={() => {}} resolver={resolver} ariaLabel="addr" />);
    await waitFor(() =>
      expect(screen.getByText("{{contracts-info/uri-root}}").className).toContain("vh-resolved"),
    );
    expect(resolver).toHaveBeenCalledWith("{{contracts-info/uri-root}}");
  });

  it("marks an unresolved variable as an error and shows no resolved value", async () => {
    r(<VarHighlightInput value="{{host}}" onChange={() => {}} resolver={vi.fn(unresolved(["host"]))} ariaLabel="addr" />);
    await waitFor(() => expect(screen.getByText("{{host}}").className).toContain("vh-error"));
    expect(screen.queryByText("localhost:5002")).toBeNull();
  });

  it("marks a chained token whose value references a missing var as an error", async () => {
    // {{uri-root}} is defined (in the collection) but its value is {{notes-api-root}},
    // which the active env lacks. The whole-template report lists the LEAF name
    // (notes-api-root) in unresolved_vars — not the surface token uri-root — so coloring
    // by name-membership would wrongly mark {{uri-root}} resolved. Per-token resolve of
    // {{uri-root}} alone reports the missing leaf, so the token must show as an error.
    const resolver = vi.fn(async () => ({
      resolved: "{{notes-api-root}}/v1",
      unresolved_vars: ["notes-api-root"],
      cycle_chain: null,
      dynamic_vars: [],
    }));
    r(<VarHighlightInput value="{{uri-root}}/v1" onChange={() => {}} resolver={resolver} ariaLabel="addr" />);
    await waitFor(() => expect(screen.getByText("{{uri-root}}").className).toContain("vh-error"));
    expect(screen.getByText("{{uri-root}}").className).not.toContain("vh-resolved");
    expect(resolver).toHaveBeenCalledWith("{{uri-root}}");
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

  it("paints a builtin token as dynamic", async () => {
    const resolver = vi.fn(async (t: string) => ({
      resolved: t,
      unresolved_vars: [] as string[],
      cycle_chain: null,
      dynamic_vars: t.includes("$guid") ? ["$guid"] : [],
    }));
    const { container } = r(
      <VarHighlightInput value="{{$guid}}" onChange={() => {}} resolver={resolver} />,
    );
    await waitFor(() =>
      expect(container.querySelector(".vh-dynamic")).not.toBeNull(),
    );
  });

  it("keeps the input focused (no remount) when a resolved field is cleared", async () => {
    // Regression: the field used to flip its root element between <Tooltip>{field}</Tooltip>
    // (resolved value present) and a bare <div> (empty value), which remounts the <input>
    // and drops focus — so select-all + delete kicked the caret out of the field.
    function Host() {
      const [v, setV] = useState("{{host}}");
      return (
        <>
          <VarHighlightInput value={v} onChange={setV} resolver={ok("api.staging")} ariaLabel="addr" />
          <button onClick={() => setV("")}>clear</button>
        </>
      );
    }
    r(<Host />);
    await waitFor(() => expect(screen.getByText("api.staging")).toBeInTheDocument()); // report resolved
    const input = screen.getByLabelText("addr") as HTMLInputElement; // node after the resolve settled
    act(() => input.focus()); // Radix Tooltip opens on focus — a React state update
    expect(document.activeElement).toBe(input);

    fireEvent.click(screen.getByText("clear")); // select-all + delete ⇒ value goes empty

    expect(screen.getByLabelText("addr")).toBe(input); // same DOM node — not remounted
    expect(document.activeElement).toBe(input); // focus preserved
  });
});

const VARS: VarCandidate[] = [
  { name: "host", value: "api.staging", origin: "env" },
  { name: "hostname", value: "h", origin: "collection" },
  { name: "token", value: "jwt", origin: "env" },
];

function typeInto(input: HTMLInputElement, value: string) {
  act(() => input.focus()); // Radix Tooltip opens on focus — a React state update
  fireEvent.change(input, { target: { value } });
  // place caret at end (jsdom doesn't track it from change)
  input.setSelectionRange(value.length, value.length);
  fireEvent.keyUp(input, { key: value.slice(-1) });
}

describe("VarHighlightInput autocomplete", () => {
  it("opens a listbox filtered by the partial after {{", () => {
    const onChange = vi.fn();
    render(<VarHighlightInput value="" onChange={onChange} ariaLabel="addr" variables={VARS} />);
    const input = screen.getByLabelText("addr") as HTMLInputElement;
    typeInto(input, "{{host");
    const opts = screen.getAllByRole("option");
    expect(opts.map((o) => o.textContent)).toEqual([
      expect.stringContaining("host"),
      expect.stringContaining("hostname"),
    ]);
    expect(input).toHaveAttribute("aria-expanded", "true");
  });

  it("Enter inserts the active variable with closing braces", () => {
    const onChange = vi.fn();
    render(<VarHighlightInput value="" onChange={onChange} ariaLabel="addr" variables={VARS} />);
    const input = screen.getByLabelText("addr") as HTMLInputElement;
    typeInto(input, "{{host");
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onChange).toHaveBeenLastCalledWith("{{host}}");
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("Escape closes the listbox without inserting", () => {
    render(<VarHighlightInput value="" onChange={() => {}} ariaLabel="addr" variables={VARS} />);
    const input = screen.getByLabelText("addr") as HTMLInputElement;
    typeInto(input, "{{ho");
    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("does not open when there are no variables", () => {
    render(<VarHighlightInput value="" onChange={() => {}} ariaLabel="addr" />);
    const input = screen.getByLabelText("addr") as HTMLInputElement;
    typeInto(input, "{{ho");
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("caps the list at 8 (no scroll) and shows an '…ещё M' hint", () => {
    const many: VarCandidate[] = Array.from({ length: 10 }, (_, i) => ({
      name: `var${i}`,
      value: "x",
      origin: "env" as const,
    }));
    render(<VarHighlightInput value="" onChange={() => {}} ariaLabel="addr" variables={many} />);
    const input = screen.getByLabelText("addr") as HTMLInputElement;
    typeInto(input, "{{var"); // all 10 match → capped to 8, 2 hidden
    expect(screen.getAllByRole("option")).toHaveLength(8);
    expect(screen.getByText(messages.vars.suggest.moreResults(2))).toBeInTheDocument();
  });
});
