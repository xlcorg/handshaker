import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: ({ count }: { count: number }) => ({
    getTotalSize: () => count * 22,
    getVirtualItems: () =>
      Array.from({ length: count }, (_, index) => ({ key: index, index, start: index * 22, size: 22 })),
    scrollToIndex: vi.fn(),
  }),
}));

import { JsonTree } from "./JsonTreeView";
import { parseJsonTree } from "./jsonTree";

const base = {
  matchIds: new Set<string>(),
  activeMatchId: null,
  scrollToId: null,
  onToggle: () => {},
  onCopy: () => {},
};

describe("JsonTree (JSON lines)", () => {
  it("renders real JSON lines including closing braces", () => {
    const tree = parseJsonTree(`{"a":{"b":1},"c":2}`);
    render(<JsonTree tree={tree} collapsed={new Set()} {...base} />);
    expect(screen.getByText(`"a"`)).toBeInTheDocument();
    expect(screen.getByText(`"b"`)).toBeInTheDocument();
    expect(screen.getByText(`"c"`)).toBeInTheDocument();
    expect(screen.getByText("},")).toBeInTheDocument(); // close of "a" (trailing comma)
    expect(screen.getByText("}")).toBeInTheDocument();  // close of root
  });

  it("collapsing a container hides its children and its closing brace", () => {
    const tree = parseJsonTree(`{"a":{"b":1},"c":2}`);
    const aId = tree.order.find((id) => tree.nodes[id].key === "a")!;
    const { rerender } = render(<JsonTree tree={tree} collapsed={new Set()} {...base} />);
    expect(screen.getByText(`"b"`)).toBeInTheDocument();
    rerender(<JsonTree tree={tree} collapsed={new Set([aId])} {...base} />);
    expect(screen.queryByText(`"b"`)).not.toBeInTheDocument();
    expect(screen.getByText(/\{ … \}/)).toBeInTheDocument();
  });

  it("shows line numbers", () => {
    const tree = parseJsonTree(`{"a":1}`); // 3 lines: {  "a": 1  }
    render(<JsonTree tree={tree} collapsed={new Set()} {...base} />);
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
  });

  it("wires toggle through to a container line", async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();
    const tree = parseJsonTree(`{"obj":{"a":1}}`);
    render(<JsonTree tree={tree} collapsed={new Set()} {...base} onToggle={onToggle} />);
    await user.click(screen.getAllByRole("button", { name: "toggle-node" })[0]);
    expect(onToggle).toHaveBeenCalled();
  });
});
