import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, createEvent } from "@testing-library/react";
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

  it("'No environment' is an extralight row (font-extralight, whose Inter 200 face is bundled)", async () => {
    const user = userEvent.setup();
    setup();
    await user.click(screen.getByText("env-trigger"));
    const item = await screen.findByText("No environment");
    const className = item.closest("[data-slot='dropdown-menu-item']")!.className;
    // font-thin (100) is never bundled and renders too faint; font-extralight (200) is.
    expect(className).not.toContain("font-thin");
    expect(className).toContain("font-extralight");
  });

  it("shows the Ctrl+E shortcut hint in the header (non-mac UA)", async () => {
    const user = userEvent.setup();
    setup();
    await user.click(screen.getByText("env-trigger"));
    // jsdom's default UA is not macOS, so isMacOS === false → "Ctrl+E".
    expect(await screen.findByText("Ctrl+E")).toBeInTheDocument();
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
    // jsdom DragEvents drop clientY entirely, so every dragOver resolves to zone "after".
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

  // jsdom's DragEvent ignores clientY from the init dict — use createEvent +
  // Object.defineProperty so zoneFromPointer sees a real number.
  function dragEventAt(node: Element, type: "dragOver" | "drop", clientY: number) {
    const e = createEvent[type](node as HTMLElement) as DragEvent;
    Object.defineProperty(e, "clientY", { value: clientY });
    fireEvent(node, e);
  }

  it("no DropLine is shown while hovering a no-op drop position", async () => {
    const user = userEvent.setup();
    setup();
    await user.click(screen.getByText("env-trigger"));
    const prodRow = (await screen.findByText("prod")).closest("[data-env-row]") as HTMLElement;
    const localRow = screen.getByText("local").closest("[data-env-row]") as HTMLElement;
    // envs are [prod, local]: dropping local AFTER prod is where it already is — a no-op.
    fireEvent.dragStart(localRow);
    fireEvent.dragOver(prodRow, { clientY: 5 }); // jsdom ⇒ zone "after"
    expect(document.querySelector("[data-drop-line]")).toBeNull();
    // A real move (prod after local) still shows the indicator.
    fireEvent.dragEnd(localRow);
    fireEvent.dragStart(prodRow);
    fireEvent.dragOver(localRow, { clientY: 5 });
    expect(document.querySelector("[data-drop-line]")).not.toBeNull();
  });

  it("dropping above a row's midpoint inserts before it", async () => {
    const user = userEvent.setup();
    // envs = [prod, local] so dragging local BEFORE prod → ["local", "prod"]
    const { onReorder } = setup();
    await user.click(screen.getByText("env-trigger"));
    const prodRow = (await screen.findByText("prod")).closest("[data-env-row]") as HTMLElement;
    const localRow = screen.getByText("local").closest("[data-env-row]") as HTMLElement;
    // Give prodRow a real rect so zoneFromPointer sees top:0, height:20 ⇒ midpoint=10.
    vi.spyOn(prodRow, "getBoundingClientRect").mockReturnValue({
      top: 0, height: 20, bottom: 20, left: 0, right: 0, width: 0, x: 0, y: 0,
      toJSON: () => ({}),
    } as DOMRect);
    fireEvent.dragStart(localRow);
    dragEventAt(prodRow, "dragOver", 5); // 5 < midpoint 10 ⇒ "before"
    dragEventAt(prodRow, "drop", 5);
    expect(onReorder).toHaveBeenCalledWith(["local", "prod"]);
  });
});
