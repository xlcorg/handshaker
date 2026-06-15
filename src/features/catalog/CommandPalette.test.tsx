import { describe, it, expect, vi } from "vitest";
import * as React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CommandPalette } from "./CommandPalette";
import type { CollectionIpc, ItemIpc, SavedRequestIpc } from "@/ipc/bindings";

function req(id: string, name: string, over: Partial<SavedRequestIpc> = {}): ItemIpc {
  return {
    type: "request", id, name, address_template: "h:443", service: "edo.attorney.v1.Letters",
    method: name, body_template: "{}", metadata: [], auth: { kind: "none" },
    tls_override: null, last_used_at: null, use_count: 0, ...over,
  };
}
function col(id: string, name: string, items: ItemIpc[]): CollectionIpc {
  return {
    id, name, items, variables: {}, auth: { kind: "none" }, default_tls: false,
    skip_tls_verify: false, pinned: false, description: null, created_at: 0, expanded: false,
  };
}
const TREE: CollectionIpc[] = [
  col("c1", "edo-attorney-letters", [req("r1", "Search"), req("r2", "SearchByInn"), req("r3", "GetStatus")]),
  col("c2", "edo-billing", [req("r4", "Charge")]),
];

function setup(over: Partial<React.ComponentProps<typeof CommandPalette>> = {}) {
  const props = {
    open: true,
    onClose: vi.fn(),
    collections: TREE,
    onOpenRequest: vi.fn(),
    onOpenCollection: vi.fn(),
    ...over,
  };
  render(<CommandPalette {...props} />);
  return props;
}

async function type(user: ReturnType<typeof userEvent.setup>, text: string) {
  const input = screen.getByPlaceholderText(/methods in|collections and requests/i);
  await user.click(input);
  await user.keyboard(text);
}

describe("CommandPalette", () => {
  it("shows the empty hint before typing", () => {
    setup();
    expect(screen.getByText(/start typing/i)).toBeInTheDocument();
  });

  it("lists matching collections and requests in flat mode", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    setup();
    await type(user, "edo");
    expect(screen.getByText("Collections")).toBeInTheDocument();
    expect(screen.getByText("Requests")).toBeInTheDocument();
    // A collection name shows both as a collection row and as the muted label on its
    // request rows; highlighted rows also split the name into per-char spans (RTL only
    // matches leaf nodes). So assert presence (>=1), not uniqueness.
    expect(screen.getAllByText("edo-attorney-letters").length).toBeGreaterThan(0);
    expect(screen.getAllByText("edo-billing").length).toBeGreaterThan(0);
  });

  it("opens a request on Enter", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    const props = setup();
    await type(user, "searchbyinn");
    await user.keyboard("{Enter}");
    expect(props.onOpenRequest).toHaveBeenCalledWith("c1", expect.objectContaining({ id: "r2" }));
    expect(props.onClose).toHaveBeenCalled();
  });

  it("opens a collection overview on Enter", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    const props = setup();
    await type(user, "edo-attorney");
    await user.keyboard("{Enter}");
    expect(props.onOpenCollection).toHaveBeenCalledWith("c1");
  });

  it("Tab on a collection drills into scope, then Enter opens a method", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    const props = setup();
    await type(user, "edo-attorney");
    await user.keyboard("{Tab}");
    expect(screen.getByPlaceholderText(/methods in edo-attorney-letters/i)).toBeInTheDocument();
    await user.keyboard("search");
    await user.keyboard("{Enter}");
    expect(props.onOpenRequest).toHaveBeenCalledWith("c1", expect.objectContaining({ id: "r1" }));
  });

  it("commits the best collection as scope on '.'", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    setup();
    await type(user, "edo-attorney");
    await user.keyboard(".");
    expect(screen.getByPlaceholderText(/methods in edo-attorney-letters/i)).toBeInTheDocument();
  });

  it("Tab on a request completes its name into the input", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    setup();
    await type(user, "edo-attorney");
    await user.keyboard("{Tab}");
    await user.keyboard("sea");
    await user.keyboard("{Tab}");
    expect(screen.getByPlaceholderText(/methods in edo-attorney-letters/i)).toHaveValue("Search");
  });

  it("Backspace on an empty input pops the scope", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    setup();
    await type(user, "edo-attorney");
    await user.keyboard("{Tab}");
    expect(screen.getByPlaceholderText(/methods in/i)).toBeInTheDocument();
    await user.keyboard("{Backspace}");
    expect(screen.getByPlaceholderText(/collections and requests/i)).toBeInTheDocument();
  });
});
