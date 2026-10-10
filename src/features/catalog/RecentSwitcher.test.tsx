import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import type { CollectionIpc, ItemIpc, SavedRequestIpc } from "@/ipc/bindings";
import { workflowStore } from "@/features/workflow/store";
import { savedRequestToDraft } from "./mapping";
import { RecentSwitcher, type RecentSwitcherProps } from "./RecentSwitcher";

function req(
  id: string,
  name: string,
  method: string,
): Extract<ItemIpc, { type: "request" }> {
  const saved: SavedRequestIpc = {
    id,
    name,
    address_template: "h:443",
    service: "edo.attorney.v1.Letters",
    method,
    body_template: "{}",
    metadata: [],
    auth: { kind: "none" },
    tls_override: null,
    last_used_at: null,
    use_count: 0,
  };
  return { type: "request", ...saved };
}

function col(id: string, name: string, items: ItemIpc[]): CollectionIpc {
  return {
    id,
    name,
    items,
    variables: {},
    auth: { kind: "none" },
    default_tls: false,
    skip_tls_verify: false,
    pinned: false,
    description: null,
    created_at: 0,
    expanded: false,
  };
}

const A = req("a", "Alpha", "GetAlpha");
const B = req("b", "Beta", "GetBeta");
const TREE = [col("c1", "C1", [A, B])];

function key(type: "keydown" | "keyup", init: KeyboardEventInit) {
  const ev = new KeyboardEvent(type, {
    bubbles: true,
    cancelable: true,
    ...init,
  });
  act(() => {
    window.dispatchEvent(ev);
  });
  return ev;
}

function show(item: Extract<ItemIpc, { type: "request" }>) {
  act(() => {
    workflowStore.setDraft(savedRequestToDraft(item), {
      collectionId: "c1",
      requestId: item.id,
      requestName: item.name,
    });
  });
}

function setup(over: Partial<RecentSwitcherProps> = {}) {
  const props: RecentSwitcherProps = {
    overviewId: null,
    collections: TREE,
    onOpenRequest: vi.fn(),
    onOpenCollection: vi.fn(),
    onRevealDraft: vi.fn(),
    ...over,
  };
  const view = render(<RecentSwitcher {...props} />);
  return { props, ...view };
}

beforeEach(() => {
  workflowStore.reset();
});

describe("RecentSwitcher", () => {
  it("opens the previous request on Ctrl+Tab and a Control keyup", () => {
    const { props } = setup();
    show(A);
    show(B);

    const down = key("keydown", { key: "Tab", ctrlKey: true });
    expect(down.defaultPrevented).toBe(true);
    expect(
      screen.getByRole("listbox", { name: "Recently opened" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("option", { selected: true })).toHaveTextContent(
      "Alpha",
    );
    expect(screen.getByRole("option", { selected: true })).toHaveTextContent(
      "Letters/GetAlpha",
    );

    const up = key("keyup", { key: "Control" });
    expect(up.defaultPrevented).toBe(false);
    expect(props.onOpenRequest).toHaveBeenCalledTimes(1);
    expect(props.onOpenRequest).toHaveBeenCalledWith("c1", A);
    expect(props.onOpenCollection).not.toHaveBeenCalled();
    expect(props.onRevealDraft).not.toHaveBeenCalled();
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();

    key("keyup", { key: "Control" });
    expect(props.onOpenRequest).toHaveBeenCalledTimes(1);
  });

  it("closes on Escape and does not open a row when Control comes up later", () => {
    const { props } = setup();
    show(A);
    show(B);
    key("keydown", { key: "Tab", ctrlKey: true });
    expect(
      screen.getByRole("listbox", { name: "Recently opened" }),
    ).toBeInTheDocument();

    const menu = new MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
    });
    act(() => {
      window.dispatchEvent(menu);
    });
    expect(menu.defaultPrevented).toBe(true);
    expect(
      screen.getByRole("listbox", { name: "Recently opened" }),
    ).toBeInTheDocument();

    const esc = key("keydown", { key: "Escape" });
    expect(esc.defaultPrevented).toBe(true);
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(props.onOpenRequest).not.toHaveBeenCalled();
    expect(props.onRevealDraft).not.toHaveBeenCalled();
    expect(props.onOpenCollection).not.toHaveBeenCalled();

    key("keyup", { key: "Control" });
    expect(props.onOpenRequest).not.toHaveBeenCalled();
  });

  it("closes on window blur without opening a row", () => {
    const { props } = setup();
    show(A);
    show(B);
    key("keydown", { key: "Tab", ctrlKey: true });
    expect(
      screen.getByRole("listbox", { name: "Recently opened" }),
    ).toBeInTheDocument();

    act(() => {
      window.dispatchEvent(new Event("blur"));
    });
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(props.onOpenRequest).not.toHaveBeenCalled();
    expect(props.onRevealDraft).not.toHaveBeenCalled();
    expect(props.onOpenCollection).not.toHaveBeenCalled();
  });

  it("keeps holding on a pointerdown inside the list and cancels on one outside", () => {
    const { props } = setup();
    show(A);
    show(B);
    key("keydown", { key: "Tab", ctrlKey: true });
    const list = screen.getByRole("listbox", { name: "Recently opened" });

    act(() => {
      list.dispatchEvent(
        new MouseEvent("pointerdown", {
          bubbles: true,
          cancelable: true,
          button: 0,
        }),
      );
    });
    expect(
      screen.getByRole("listbox", { name: "Recently opened" }),
    ).toBeInTheDocument();
    expect(props.onOpenRequest).not.toHaveBeenCalled();

    act(() => {
      window.dispatchEvent(
        new MouseEvent("pointerdown", {
          bubbles: true,
          cancelable: true,
          button: 0,
        }),
      );
    });
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(props.onOpenRequest).not.toHaveBeenCalled();
    expect(props.onRevealDraft).not.toHaveBeenCalled();
    expect(props.onOpenCollection).not.toHaveBeenCalled();
  });

  it("swallows the contextmenu that follows an outside Ctrl+click", () => {
    const { props } = setup();
    show(A);
    show(B);
    key("keydown", { key: "Tab", ctrlKey: true });

    act(() => {
      window.dispatchEvent(
        new MouseEvent("pointerdown", {
          bubbles: true,
          cancelable: true,
          button: 0,
          ctrlKey: true,
        }),
      );
    });
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();

    const menu = new MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
    });
    act(() => {
      window.dispatchEvent(menu);
    });
    expect(menu.defaultPrevented).toBe(true);
    expect(props.onOpenRequest).not.toHaveBeenCalled();
    expect(props.onRevealDraft).not.toHaveBeenCalled();
    expect(props.onOpenCollection).not.toHaveBeenCalled();
  });

  it("commits the highlighted row on primary mousedown and swallows the following contextmenu", () => {
    const { props } = setup();
    show(A);
    show(B);
    key("keydown", { key: "Tab", ctrlKey: true });
    const option = screen.getByRole("option", { selected: true });
    const down = new MouseEvent("mousedown", {
      bubbles: true,
      cancelable: true,
      button: 0,
    });
    const menu = new MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
    });

    act(() => {
      option.dispatchEvent(
        new MouseEvent("pointerdown", {
          bubbles: true,
          cancelable: true,
          button: 0,
        }),
      );
      option.dispatchEvent(down);
      window.dispatchEvent(menu);
    });

    expect(down.defaultPrevented).toBe(true);
    expect(menu.defaultPrevented).toBe(true);
    expect(props.onOpenRequest).toHaveBeenCalledTimes(1);
    expect(props.onOpenRequest).toHaveBeenCalledWith("c1", A);
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();

    const later = new MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
    });
    act(() => {
      window.dispatchEvent(later);
    });
    expect(later.defaultPrevented).toBe(false);
  });

  it("does not open from a key that arrives after a lost Control keyup", () => {
    const { props } = setup();
    show(A);
    show(B);
    key("keydown", { key: "Tab", ctrlKey: true });
    expect(screen.getByRole("option", { selected: true })).toHaveTextContent(
      "Alpha",
    );

    const letter = key("keydown", { key: "k", ctrlKey: true });
    expect(letter.defaultPrevented).toBe(false);
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(props.onOpenRequest).not.toHaveBeenCalled();

    key("keyup", { key: "Control" });
    expect(props.onOpenRequest).not.toHaveBeenCalled();
  });

  it("swallows Ctrl+Tab while a dialog is focused, and still moves the cursor once the list is open", () => {
    const onOpenRequest = vi.fn();
    render(
      <>
        <div role="dialog">
          <button type="button">Stay</button>
        </div>
        <RecentSwitcher
          overviewId={null}
          collections={TREE}
          onOpenRequest={onOpenRequest}
          onOpenCollection={vi.fn()}
          onRevealDraft={vi.fn()}
        />
      </>,
    );
    show(A);
    show(B);
    screen.getByRole("button", { name: "Stay" }).focus();

    const blocked = key("keydown", { key: "Tab", ctrlKey: true });
    expect(blocked.defaultPrevented).toBe(true);
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(onOpenRequest).not.toHaveBeenCalled();

    (document.activeElement as HTMLElement).blur();
    key("keydown", { key: "Tab", ctrlKey: true });
    expect(screen.getByRole("option", { selected: true })).toHaveTextContent(
      "Alpha",
    );

    screen.getByRole("button", { name: "Stay" }).focus();
    key("keydown", { key: "Tab", ctrlKey: true });
    expect(screen.getByRole("option", { selected: true })).toHaveTextContent(
      "Beta",
    );
    expect(onOpenRequest).not.toHaveBeenCalled();
  });

  it("reveals the loaded draft when the chord releases on that row", () => {
    const { props, rerender } = setup();
    show(A);
    rerender(<RecentSwitcher {...props} overviewId="c1" />);

    key("keydown", { key: "Tab", ctrlKey: true });
    expect(screen.getByRole("option", { selected: true })).toHaveTextContent(
      "Alpha",
    );
    key("keyup", { key: "Control" });

    expect(props.onRevealDraft).toHaveBeenCalledTimes(1);
    expect(props.onOpenRequest).not.toHaveBeenCalled();
    expect(props.onOpenCollection).not.toHaveBeenCalled();
  });
});
