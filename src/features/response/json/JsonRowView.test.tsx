import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { JsonRowView } from "./JsonRowView";
import { parseJsonTree } from "./jsonTree";

const node = (json: string, key: string) => {
  const t = parseJsonTree(json);
  const root = t.nodes[t.rootId!];
  return root.childIds.map((id) => t.nodes[id]).find((n) => n.key === key)!;
};

describe("JsonRowView", () => {
  it("renders key + quoted preview for a string leaf and copies on double-click", async () => {
    const user = userEvent.setup();
    const onCopy = vi.fn();
    const n = node(`{"name":"Alice"}`, "name");
    render(
      <JsonRowView node={n} collapsed={false} isMatch={false} isActiveMatch={false}
        onToggle={() => {}} onCopy={onCopy} />,
    );
    expect(screen.getByText("name")).toBeInTheDocument();
    expect(screen.getByText(`"Alice"`)).toBeInTheDocument();
    await user.dblClick(screen.getByText(`"Alice"`));
    expect(onCopy).toHaveBeenCalledWith(n);
  });

  it("shows a caret for a container and toggles without triggering copy", async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();
    const onCopy = vi.fn();
    const n = node(`{"obj":{"a":1}}`, "obj");
    render(
      <JsonRowView node={n} collapsed isMatch={false} isActiveMatch={false}
        onToggle={onToggle} onCopy={onCopy} />,
    );
    expect(screen.getByText("{1}")).toBeInTheDocument(); // collapsed container preview
    await user.click(screen.getByRole("button", { name: "toggle-node" }));
    expect(onToggle).toHaveBeenCalledWith(n.id);
    expect(onCopy).not.toHaveBeenCalled();
  });

  it("exposes the full value as a tooltip title", () => {
    const n = node(`{"s":"the full value"}`, "s");
    render(
      <JsonRowView node={n} collapsed={false} isMatch={false} isActiveMatch={false}
        onToggle={() => {}} onCopy={() => {}} />,
    );
    expect(screen.getByTitle("the full value")).toBeInTheDocument();
  });
});
