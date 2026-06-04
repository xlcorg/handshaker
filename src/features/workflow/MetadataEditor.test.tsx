import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MetadataEditor } from "./MetadataEditor";

const rows = [{ key: "x-tenant", value: "acme", enabled: true }];

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
});
