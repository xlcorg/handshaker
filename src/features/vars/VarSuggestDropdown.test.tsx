import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { VarSuggestDropdown } from "./VarSuggestDropdown";
import type { VarCandidate } from "./candidates";
import { messages } from "@/lib/messages";

const items: VarCandidate[] = [
  { name: "host", value: "api.staging", origin: "env", overrides: true },
  { name: "order_id", value: "42", origin: "collection" },
];

describe("VarSuggestDropdown", () => {
  it("renders a listbox with option rows showing name, value and origin", () => {
    render(<VarSuggestDropdown items={items} total={items.length} active={0} listboxId="lb" onPick={() => {}} left={0} top={0} />);
    expect(screen.getByRole("listbox")).toBeInTheDocument();
    const opts = screen.getAllByRole("option");
    expect(opts).toHaveLength(2);
    expect(opts[0]).toHaveAttribute("aria-selected", "true");
    expect(opts[0]).toHaveTextContent("host");
    expect(opts[0]).toHaveTextContent("api.staging");
    expect(screen.getByText("env")).toBeInTheDocument();
    expect(screen.getByText("collection")).toBeInTheDocument();
  });

  it("calls onPick with the index on mousedown", () => {
    const onPick = vi.fn();
    render(<VarSuggestDropdown items={items} total={items.length} active={0} listboxId="lb" onPick={onPick} left={0} top={0} />);
    // mousedown (not click) so the input keeps focus
    screen.getAllByRole("option")[1].dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    expect(onPick).toHaveBeenCalledWith(1);
  });

  it("caps the visible list and shows an '…ещё M' hint with honest aria-setsize", () => {
    const many: VarCandidate[] = Array.from({ length: 8 }, (_, i) => ({ name: `v${i}`, value: "", origin: "env" as const }));
    // items = the 8 visible, total = 10 ⇒ 2 hidden
    render(<VarSuggestDropdown items={many} total={10} active={0} listboxId="lb" onPick={() => {}} left={0} top={0} />);
    const opts = screen.getAllByRole("option");
    expect(opts).toHaveLength(8); // no scroll: capped, not all rendered
    expect(opts[0]).toHaveAttribute("aria-setsize", "10");
    expect(opts[0]).toHaveAttribute("aria-posinset", "1");
    expect(screen.getByText(messages.vars.suggest.moreResults(2))).toBeInTheDocument();
  });

  it("omits the hint row when nothing is hidden", () => {
    render(<VarSuggestDropdown items={items} total={items.length} active={0} listboxId="lb" onPick={() => {}} left={0} top={0} />);
    expect(screen.queryByText(/keep typing/)).toBeNull();
  });
});
