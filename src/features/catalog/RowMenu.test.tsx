import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RowMenu } from "./RowMenu";

function setup() {
  return userEvent.setup({ pointerEventsCheck: 0 });
}

describe("RowMenu", () => {
  it("opens on the ⋯ button and fires an item's onClick, then closes", async () => {
    const user = setup();
    const onClick = vi.fn();
    render(
      <RowMenu items={[{ label: "Rename", onClick }]}>
        <div>row body</div>
      </RowMenu>,
    );
    await user.click(screen.getByLabelText("More options"));
    await user.click(screen.getByText("Rename"));
    expect(onClick).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByText("Rename")).toBeNull());
  });

  it("opens at the cursor on right-click", async () => {
    render(
      <RowMenu items={[{ label: "Delete", danger: true, onClick: () => {} }]}>
        <div>row body</div>
      </RowMenu>,
    );
    fireEvent.contextMenu(screen.getByText("row body"));
    expect(await screen.findByText("Delete")).toBeTruthy();
  });
});
