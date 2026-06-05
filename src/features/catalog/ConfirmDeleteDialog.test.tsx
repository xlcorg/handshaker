import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ConfirmDeleteDialog } from "./ConfirmDeleteDialog";

describe("ConfirmDeleteDialog", () => {
  it("renders the title/description when open and confirms", () => {
    const onConfirm = vi.fn();
    const onOpenChange = vi.fn();
    render(
      <ConfirmDeleteDialog
        open
        title="Delete request?"
        description="This cannot be undone."
        onConfirm={onConfirm}
        onOpenChange={onOpenChange}
      />,
    );
    expect(screen.getByText("Delete request?")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("renders nothing visible when closed", () => {
    render(
      <ConfirmDeleteDialog
        open={false}
        title="Delete?"
        description="x"
        onConfirm={() => {}}
        onOpenChange={() => {}}
      />,
    );
    expect(screen.queryByText("Delete?")).toBeNull();
  });
});
