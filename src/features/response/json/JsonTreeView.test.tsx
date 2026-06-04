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

describe("JsonTree", () => {
  it("renders a row per visible node and hides collapsed descendants", () => {
    const tree = parseJsonTree(`{"a":{"b":1},"c":2}`);
    const aId = tree.order.find((id) => tree.nodes[id].key === "a")!;
    const { rerender } = render(
      <JsonTree tree={tree} collapsed={new Set()} matchIds={new Set()} activeMatchId={null}
        scrollToId={null} onToggle={() => {}} onCopy={() => {}} />,
    );
    expect(screen.getByText("b")).toBeInTheDocument();
    rerender(
      <JsonTree tree={tree} collapsed={new Set([aId])} matchIds={new Set()} activeMatchId={null}
        scrollToId={null} onToggle={() => {}} onCopy={() => {}} />,
    );
    expect(screen.queryByText("b")).not.toBeInTheDocument();
    expect(screen.getByText("c")).toBeInTheDocument();
  });

  it("wires copy + toggle through to rows", async () => {
    const user = userEvent.setup();
    const onCopy = vi.fn();
    const onToggle = vi.fn();
    const tree = parseJsonTree(`{"n":5}`);
    render(
      <JsonTree tree={tree} collapsed={new Set()} matchIds={new Set()} activeMatchId={null}
        scrollToId={null} onToggle={onToggle} onCopy={onCopy} />,
    );
    await user.dblClick(screen.getByText("5"));
    expect(onCopy).toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "toggle-node" })); // root container caret
    expect(onToggle).toHaveBeenCalled();
  });
});
