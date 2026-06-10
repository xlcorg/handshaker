import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { EnvSwitcherMenu } from "./EnvSwitcherMenu";

function setup() {
  const onActiveSet = vi.fn();
  const onNewEnv = vi.fn();
  const onReorder = vi.fn();
  render(
    <EnvSwitcherMenu
      envs={[
        { name: "prod", variables: {}, color: null },
        { name: "local", variables: {}, color: null },
      ]}
      trigger={<button type="button">env-trigger</button>}
      onActiveSet={onActiveSet}
      onEditEnv={() => {}}
      onNewEnv={onNewEnv}
      onReorder={onReorder}
    />,
  );
  return { onActiveSet, onNewEnv, onReorder };
}

describe("EnvSwitcherMenu", () => {
  it("selecting an env row calls onActiveSet with its name (plain items, no radio)", async () => {
    const user = userEvent.setup();
    const { onActiveSet } = setup();
    await user.click(screen.getByText("env-trigger"));
    // No radio-style items anymore.
    expect(screen.queryAllByRole("menuitemradio")).toHaveLength(0);
    await user.click(await screen.findByText("local"));
    expect(onActiveSet).toHaveBeenCalledWith("local");
  });

  it("'No environment' calls onActiveSet(null) and the header is present", async () => {
    const user = userEvent.setup();
    const { onActiveSet } = setup();
    await user.click(screen.getByText("env-trigger"));
    expect(await screen.findByText("Environments")).toBeInTheDocument();
    await user.click(screen.getByText("No environment"));
    expect(onActiveSet).toHaveBeenCalledWith(null);
  });

  it("the edit icon opens edit for that env", async () => {
    const user = userEvent.setup();
    const onEditEnv = vi.fn();
    render(
      <EnvSwitcherMenu
        envs={[{ name: "local", variables: {}, color: null }, { name: "prod", variables: {}, color: null }]}
        trigger={<button type="button">env-trigger</button>}
        onActiveSet={() => {}}
        onEditEnv={onEditEnv}
        onNewEnv={() => {}}
        onReorder={() => {}}
      />,
    );
    await user.click(screen.getByText("env-trigger"));
    await user.click(await screen.findByLabelText("Edit local"));
    expect(onEditEnv).toHaveBeenCalledWith("local");
  });

  it("renders envs in prop order (no alphabetical sorting)", async () => {
    const user = userEvent.setup();
    setup();
    await user.click(screen.getByText("env-trigger"));
    const prod = await screen.findByText("prod");
    const local = screen.getByText("local");
    // prod (first in props) must precede local in the DOM.
    expect(prod.compareDocumentPosition(local) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("'No environment' is a regular-size row (no font-thin)", async () => {
    const user = userEvent.setup();
    setup();
    await user.click(screen.getByText("env-trigger"));
    const item = await screen.findByText("No environment");
    expect(item.closest("[data-slot='dropdown-menu-item']")!.className).not.toContain("font-thin");
  });

  it("header has a + button that calls onNewEnv; no bottom 'New env…' item", async () => {
    const user = userEvent.setup();
    const { onNewEnv } = setup();
    await user.click(screen.getByText("env-trigger"));
    expect(screen.queryByText(/New env/)).not.toBeInTheDocument();
    const plus = await screen.findByLabelText("New environment");
    expect(plus.className).not.toContain("opacity-0");
    await user.click(plus);
    expect(onNewEnv).toHaveBeenCalled();
  });

  it("drag-and-drop of an env row fires onReorder with the full new order", async () => {
    const user = userEvent.setup();
    const { onReorder } = setup();
    await user.click(screen.getByText("env-trigger"));
    const prodRow = (await screen.findByText("prod")).closest("[data-env-row]")!;
    const localRow = screen.getByText("local").closest("[data-env-row]")!;
    fireEvent.dragStart(prodRow);
    // jsdom rects are zero-size: clientY 5 ⇒ zone "after", clientY -5 ⇒ "before".
    fireEvent.dragOver(localRow, { clientY: 5 });
    fireEvent.drop(localRow, { clientY: 5 });
    expect(onReorder).toHaveBeenCalledWith(["local", "prod"]);
  });

  it("a no-op drop (same resulting order) does not fire onReorder", async () => {
    const user = userEvent.setup();
    const { onReorder } = setup();
    await user.click(screen.getByText("env-trigger"));
    const prodRow = (await screen.findByText("prod")).closest("[data-env-row]")!;
    // jsdom DragEvent doesn't propagate clientY (always undefined → NaN < 0 = false → "after").
    // So: drag "local" after "prod" → ["prod", "local"] = same order → no-op.
    const localRow = screen.getByText("local").closest("[data-env-row]")!;
    fireEvent.dragStart(localRow);
    fireEvent.dragOver(prodRow, { clientY: 5 }); // jsdom always gives zone "after"
    fireEvent.drop(prodRow, { clientY: 5 });
    expect(onReorder).not.toHaveBeenCalled();
  });

  it("the 'No environment' row is not draggable", async () => {
    const user = userEvent.setup();
    setup();
    await user.click(screen.getByText("env-trigger"));
    const none = await screen.findByText("No environment");
    expect(none.closest("[data-env-row]")).toBeNull();
    expect((none.closest("[data-slot='dropdown-menu-item']") as HTMLElement).draggable).toBe(false);
  });
});
