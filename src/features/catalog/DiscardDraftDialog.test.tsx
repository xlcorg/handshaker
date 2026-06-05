import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { DiscardDraftDialog } from "./DiscardDraftDialog";

function props(over = {}) {
  return { open: true, onOpenChange: vi.fn(), onDiscard: vi.fn(), onSaveFirst: vi.fn(), ...over };
}

describe("DiscardDraftDialog", () => {
  it("fires onDiscard and closes", () => {
    const p = props();
    render(<DiscardDraftDialog {...p} />);
    fireEvent.click(screen.getByRole("button", { name: "Discard" }));
    expect(p.onDiscard).toHaveBeenCalledTimes(1);
    expect(p.onOpenChange).toHaveBeenCalledWith(false);
  });

  it("fires onSaveFirst and closes", () => {
    const p = props();
    render(<DiscardDraftDialog {...p} />);
    fireEvent.click(screen.getByRole("button", { name: /save/i }));
    expect(p.onSaveFirst).toHaveBeenCalledTimes(1);
    expect(p.onOpenChange).toHaveBeenCalledWith(false);
  });
});
