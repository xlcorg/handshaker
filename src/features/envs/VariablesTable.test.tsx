import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
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
});
