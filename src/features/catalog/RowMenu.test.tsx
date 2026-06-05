import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { RowMenu } from "./RowMenu";

describe("RowMenu", () => {
  it("opens on the ⋯ button and fires an item's onClick, then closes", () => {
    const onClick = vi.fn();
    render(
      <RowMenu items={[{ label: "Rename", onClick }]}>
        <div>row body</div>
      </RowMenu>,
    );
    fireEvent.click(screen.getByLabelText("More options"));
    fireEvent.click(screen.getByText("Rename"));
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("Rename")).toBeNull();
  });

  it("opens at the cursor on right-click", () => {
    render(
      <RowMenu items={[{ label: "Delete", danger: true, onClick: () => {} }]}>
        <div>row body</div>
      </RowMenu>,
    );
    fireEvent.contextMenu(screen.getByText("row body"));
    expect(screen.getByText("Delete")).toBeTruthy();
  });
});
