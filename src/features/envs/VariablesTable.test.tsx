import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { VariablesTable } from "./VariablesTable";

describe("VariablesTable", () => {
  it("does not flag keys with dots / digits / spaces as invalid", async () => {
    const user = userEvent.setup();
    render(<VariablesTable value={{}} onChange={() => {}} />);
    await user.type(screen.getByPlaceholderText("Add variable"), "user.id");
    const input = screen.getByDisplayValue("user.id");
    expect(input.className).not.toContain("text-destructive");
    expect(input).not.toHaveAttribute("title");
  });

  it("still warns about duplicate keys", async () => {
    const user = userEvent.setup();
    render(<VariablesTable value={{ token: "a" }} onChange={() => {}} />);
    // Type the same key in the trailing empty row → duplicate.
    await user.type(screen.getByPlaceholderText("Add variable"), "token");
    expect(screen.getByText(/duplicate key/i)).toBeInTheDocument();
  });

  it("renders value cells as multiline-capable textareas", () => {
    render(<VariablesTable value={{ token: "abc123" }} onChange={() => {}} />);
    const valueEl = screen.getByDisplayValue("abc123");
    expect(valueEl.tagName).toBe("TEXTAREA");
  });

  it("a focused value that fits does not enable a scrollbar (zoom-rounding guard)", () => {
    render(<VariablesTable value={{ token: "abc123" }} onChange={() => {}} />);
    const valueEl = screen.getByDisplayValue("abc123");
    fireEvent.focus(valueEl);
    // Content fits under the cap → the box is sized exactly to the content, so we
    // must NOT leave overflow:auto on (under a fractional webview zoom factor
    // scrollHeight rounds down by ~1px and a spurious vertical scrollbar appears).
    expect(valueEl.className).toContain("overflow-hidden");
    expect(valueEl.className).not.toContain("overflow-y-auto");
  });

  it("a focused value taller than the cap scrolls vertically only (no horizontal bar)", () => {
    render(<VariablesTable value={{ token: "abc123" }} onChange={() => {}} />);
    const valueEl = screen.getByDisplayValue("abc123");
    // jsdom has no layout (scrollHeight === 0); force the over-the-cap branch.
    Object.defineProperty(valueEl, "scrollHeight", { configurable: true, get: () => 999 });
    fireEvent.focus(valueEl);
    expect(valueEl.className).toContain("overflow-y-auto");
    // break-all wrapping means a horizontal scrollbar is never wanted; pin
    // overflow-x hidden so it can't compute to `auto` (CSS spec) and add a bar.
    expect(valueEl.className).toContain("overflow-x-hidden");
  });

  it("keeps the key cell a single-line input", () => {
    render(<VariablesTable value={{ token: "abc123" }} onChange={() => {}} />);
    const keyEl = screen.getByDisplayValue("token");
    expect(keyEl.tagName).toBe("INPUT");
  });

  it("editing a value cell propagates through onChange", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<VariablesTable value={{ token: "" }} onChange={onChange} />);
    await user.type(screen.getByPlaceholderText("value"), "secret");
    expect(onChange).toHaveBeenLastCalledWith({ token: "secret" });
  });

  it("shows a resolve preview row under a value with {{vars}}", async () => {
    const resolveRow = vi.fn(async () => ({
      resolved: "https://api.example.com",
      unresolved_vars: [],
      cycle_chain: null,
      dynamic_vars: [],
    }));
    render(
      <VariablesTable
        value={{ "uri-root": "{{notes-api-root}}" }}
        onChange={() => {}}
        resolveRow={resolveRow}
        resolveKey="k"
      />,
    );
    expect(await screen.findByText(/→ resolves: https:\/\/api\.example\.com/)).toBeInTheDocument();
    expect(resolveRow).toHaveBeenCalledWith("{{notes-api-root}}");
  });

  it("renders no preview row without a resolveRow prop", () => {
    render(<VariablesTable value={{ k: "{{x}}" }} onChange={() => {}} />);
    expect(screen.queryByText(/resolves|Unresolved/)).toBeNull();
  });
});
