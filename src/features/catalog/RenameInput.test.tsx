import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { RenameInput } from "./RenameInput";

describe("RenameInput", () => {
  it("commits a trimmed, changed value on Enter", () => {
    const onCommit = vi.fn();
    const onCancel = vi.fn();
    render(<RenameInput initial="old" onCommit={onCommit} onCancel={onCancel} />);
    const input = screen.getByLabelText("rename-input");
    fireEvent.change(input, { target: { value: "  new  " } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onCommit).toHaveBeenCalledWith("new");
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("cancels on Escape", () => {
    const onCommit = vi.fn();
    const onCancel = vi.fn();
    render(<RenameInput initial="old" onCommit={onCommit} onCancel={onCancel} />);
    fireEvent.keyDown(screen.getByLabelText("rename-input"), { key: "Escape" });
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("cancels (not commits) when blurred unchanged", () => {
    const onCommit = vi.fn();
    const onCancel = vi.fn();
    render(<RenameInput initial="old" onCommit={onCommit} onCancel={onCancel} />);
    fireEvent.blur(screen.getByLabelText("rename-input"));
    expect(onCommit).not.toHaveBeenCalled();
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
