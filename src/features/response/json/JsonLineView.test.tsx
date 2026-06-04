import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { JsonLineView } from "./JsonLineView";
import { parseJsonTree } from "./jsonTree";
import { flattenLines } from "./jsonLines";

/** Build (line, node, lineNumber) rows for a json so tests pick a specific line. */
function rows(json: string, collapsedKeys: string[] = []) {
  const tree = parseJsonTree(json);
  const collapsed = new Set(collapsedKeys.map((k) => tree.order.find((id) => tree.nodes[id].key === k)!));
  return flattenLines(tree, collapsed).map((line, i) => ({ line, node: tree.nodes[line.nodeId], n: i + 1 }));
}

const noop = () => {};

describe("JsonLineView", () => {
  it("renders a quoted key, quoted string value and a trailing comma", () => {
    const r = rows(`{"name":"Alice","x":1}`).find((x) => x.node.key === "name")!;
    render(<JsonLineView line={r.line} node={r.node} lineNumber={r.n}
      isMatch={false} isActiveMatch={false} onToggle={noop} onCopy={noop} />);
    expect(screen.getByText(`"name"`)).toBeInTheDocument();
    expect(screen.getByText(`"Alice"`)).toBeInTheDocument();
    expect(screen.getByText(",")).toBeInTheDocument();
  });

  it("renders the line number", () => {
    const r = rows(`{"a":1}`).find((x) => x.node.key === "a")!;
    render(<JsonLineView line={r.line} node={r.node} lineNumber={42}
      isMatch={false} isActiveMatch={false} onToggle={noop} onCopy={noop} />);
    expect(screen.getByText("42")).toBeInTheDocument();
  });

  it("renders an expanded container open line with a caret and toggles (no copy)", async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();
    const onCopy = vi.fn();
    const r = rows(`{"obj":{"a":1}}`).find((x) => x.line.kind === "open" && x.node.key === "obj")!;
    render(<JsonLineView line={r.line} node={r.node} lineNumber={r.n}
      isMatch={false} isActiveMatch={false} onToggle={onToggle} onCopy={onCopy} />);
    expect(screen.getByText(`"obj"`)).toBeInTheDocument();
    expect(screen.getByText("{")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "toggle-node" }));
    expect(onToggle).toHaveBeenCalledWith(r.node.id);
    expect(onCopy).not.toHaveBeenCalled();
  });

  it("renders a folded container as { … } with a caret", () => {
    const r = rows(`{"obj":{"a":1}}`, ["obj"]).find((x) => x.line.kind === "folded")!;
    render(<JsonLineView line={r.line} node={r.node} lineNumber={r.n}
      isMatch={false} isActiveMatch={false} onToggle={noop} onCopy={noop} />);
    expect(screen.getByText(/\{ … \}/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "toggle-node" })).toBeInTheDocument();
  });

  it("renders a close line and copies the node on double-click", async () => {
    const user = userEvent.setup();
    const onCopy = vi.fn();
    const r = rows(`{"obj":{"a":1}}`).find((x) => x.line.kind === "close" && x.node.key === "obj")!;
    render(<JsonLineView line={r.line} node={r.node} lineNumber={r.n}
      isMatch={false} isActiveMatch={false} onToggle={noop} onCopy={onCopy} />);
    expect(screen.getByText("}")).toBeInTheDocument();
    await user.dblClick(screen.getByText("}"));
    expect(onCopy).toHaveBeenCalledWith(r.node);
  });

  it("renders an empty object as {}", () => {
    const r = rows(`{"e":{}}`).find((x) => x.node.key === "e")!;
    render(<JsonLineView line={r.line} node={r.node} lineNumber={r.n}
      isMatch={false} isActiveMatch={false} onToggle={noop} onCopy={noop} />);
    expect(screen.getByText("{}")).toBeInTheDocument();
  });

  it("does not render a tooltip (title) on the row", () => {
    const r = rows(`{"s":"some long value"}`).find((x) => x.node.key === "s")!;
    render(<JsonLineView line={r.line} node={r.node} lineNumber={r.n}
      isMatch={false} isActiveMatch={false} onToggle={noop} onCopy={noop} />);
    expect(screen.getByRole("treeitem")).not.toHaveAttribute("title");
  });
});
