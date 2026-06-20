import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { VarCandidate } from "@/features/vars/candidates";
import { MetadataEditor } from "./MetadataEditor";

const rows = [{ key: "x-tenant", value: "acme", enabled: true }];

const VARS: VarCandidate[] = [
  { name: "host", value: "api.staging", origin: "env" },
  { name: "token", value: "jwt", origin: "env" },
];

// jsdom doesn't track the caret from a change event, so place it explicitly and fire the
// keyUp that VarHighlightInput listens on (mirrors the VarHighlightInput suite helper).
function typeInto(input: HTMLInputElement, value: string) {
  input.focus();
  fireEvent.change(input, { target: { value } });
  input.setSelectionRange(value.length, value.length);
  fireEvent.keyUp(input, { key: value.slice(-1) });
}

describe("MetadataEditor", () => {
  it("edits a key and calls back with the new rows", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<MetadataEditor rows={rows} onChange={onChange} />);
    await user.type(screen.getByLabelText("metadata-key-0"), "!");
    expect(onChange).toHaveBeenLastCalledWith([{ key: "x-tenant!", value: "acme", enabled: true }]);
  });

  it("toggles enabled", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<MetadataEditor rows={rows} onChange={onChange} />);
    await user.click(screen.getByLabelText("metadata-enabled-0"));
    expect(onChange).toHaveBeenLastCalledWith([{ key: "x-tenant", value: "acme", enabled: false }]);
  });

  it("adds a row", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<MetadataEditor rows={rows} onChange={onChange} />);
    await user.click(screen.getByRole("button", { name: /add/i }));
    expect(onChange).toHaveBeenLastCalledWith([...rows, { key: "", value: "", enabled: true }]);
  });

  it("removes a row", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<MetadataEditor rows={rows} onChange={onChange} />);
    await user.click(screen.getByLabelText("metadata-remove-0"));
    expect(onChange).toHaveBeenLastCalledWith([]);
  });

  it("offers {{var}} autocomplete in the value field", () => {
    render(<MetadataEditor rows={rows} onChange={() => {}} variables={VARS} />);
    const value = screen.getByLabelText("metadata-value-0") as HTMLInputElement;
    typeInto(value, "{{ho");
    expect(screen.getByRole("listbox")).toBeInTheDocument();
    expect(screen.getByRole("option")).toHaveTextContent("host");
  });
});
