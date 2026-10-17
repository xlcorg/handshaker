import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { messages } from "@/lib/messages";

import { colorKey, storedName } from "./envDraft";
import { editorStep, initEditor, selectView, type EditorAction, type EditorState } from "./envEditor";
import { VariablesTable } from "./VariablesTable";

const m = messages.envs.editor;

function editorWith(vars: Record<string, string>): EditorState {
  const name = storedName("dev");
  return initEditor({ name, color: null, variables: Object.entries(vars), index: 0 }, [
    { name, color: colorKey("blue") },
  ]);
}

function step(state: EditorState, ...actions: EditorAction[]): EditorState {
  return actions.reduce((s, action) => editorStep(s, action).state, state);
}

function rowsOf(state: EditorState) {
  return selectView(state).rows;
}

function addRowTyping(state: EditorState, key: string): EditorState {
  const added = step(state, { type: "addRow" });
  const pending = rowsOf(added).find((row) => row.pending)!;
  return step(added, { type: "typeKey", rowId: pending.id, text: key });
}

describe("VariablesTable", () => {
  it("renders value cells as multiline-capable textareas", () => {
    render(<VariablesTable rows={rowsOf(editorWith({ token: "abc123" }))} dispatch={() => {}} />);
    expect(screen.getByDisplayValue("abc123").tagName).toBe("TEXTAREA");
  });

  it("a focused value that fits does not enable a scrollbar (zoom-rounding guard)", () => {
    render(<VariablesTable rows={rowsOf(editorWith({ token: "abc123" }))} dispatch={() => {}} />);
    const valueEl = screen.getByDisplayValue("abc123");
    fireEvent.focus(valueEl);
    // Content fits under the cap → the box is sized exactly to the content, so we
    // must NOT leave overflow:auto on (under a fractional webview zoom factor
    // scrollHeight rounds down by ~1px and a spurious vertical scrollbar appears).
    expect(valueEl.className).toContain("overflow-hidden");
    expect(valueEl.className).not.toContain("overflow-y-auto");
  });

  it("a focused value taller than the cap scrolls vertically only (no horizontal bar)", () => {
    render(<VariablesTable rows={rowsOf(editorWith({ token: "abc123" }))} dispatch={() => {}} />);
    const valueEl = screen.getByDisplayValue("abc123");
    // jsdom has no layout (scrollHeight === 0); force the over-the-cap branch.
    Object.defineProperty(valueEl, "scrollHeight", { configurable: true, get: () => 999 });
    fireEvent.focus(valueEl);
    expect(valueEl.className).toContain("overflow-y-auto");
    // break-all wrapping means a horizontal scrollbar is never wanted; pin
    // overflow-x hidden so it can't compute to `auto` (CSS spec) and add a bar.
    expect(valueEl.className).toContain("overflow-x-hidden");
  });

  it("a blurred value stays on one clipped line", () => {
    render(<VariablesTable rows={rowsOf(editorWith({ token: "abc123" }))} dispatch={() => {}} />);
    const valueEl = screen.getByDisplayValue("abc123");
    expect(valueEl.className).toContain("whitespace-nowrap");
    expect(valueEl.className).toContain("overflow-hidden");
  });

  it("keeps the key cell a single-line input", () => {
    render(<VariablesTable rows={rowsOf(editorWith({ token: "abc123" }))} dispatch={() => {}} />);
    expect(screen.getByDisplayValue("token").tagName).toBe("INPUT");
  });

  it("Enter in a key commits it", () => {
    const state = editorWith({ token: "abc123" });
    const dispatch = vi.fn();
    render(<VariablesTable rows={rowsOf(state)} dispatch={dispatch} />);
    fireEvent.keyDown(screen.getByDisplayValue("token"), { key: "Enter" });
    expect(dispatch).toHaveBeenCalledWith({ type: "commitKey", rowId: rowsOf(state)[0].id, via: "enter" });
  });

  it("Enter in a value inserts a newline and commits nothing", async () => {
    const user = userEvent.setup();
    const dispatch = vi.fn();
    render(<VariablesTable rows={rowsOf(editorWith({ token: "abc" }))} dispatch={dispatch} />);
    await user.type(screen.getByDisplayValue("abc"), "{Enter}");
    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: "editValue", text: "abc\n" }));
    expect(dispatch).not.toHaveBeenCalledWith(expect.objectContaining({ type: "commitKey" }));
  });

  it("does not flag keys with dots / digits / spaces as invalid", () => {
    render(<VariablesTable rows={rowsOf(addRowTyping(editorWith({}), "user.id 2"))} dispatch={() => {}} />);
    expect(screen.getByDisplayValue("user.id 2")).toHaveAttribute("aria-invalid", "false");
    expect(screen.queryByText(m.keyDuplicate)).toBeNull();
  });

  it("marks both rows of a duplicate key", () => {
    render(<VariablesTable rows={rowsOf(addRowTyping(editorWith({ token: "a" }), "token"))} dispatch={() => {}} />);
    const keys = screen.getAllByDisplayValue("token");
    expect(keys).toHaveLength(2);
    for (const key of keys) expect(key).toHaveAttribute("aria-invalid", "true");
    expect(screen.getAllByText(m.keyDuplicate)).toHaveLength(2);
  });

  it("marks a committed empty key", () => {
    const state = editorWith({ token: "a" });
    const rowId = rowsOf(state)[0].id;
    const cleared = step(
      state,
      { type: "typeKey", rowId, text: "" },
      { type: "commitKey", rowId, via: "blur" },
    );
    render(<VariablesTable rows={rowsOf(cleared)} dispatch={() => {}} />);
    expect(screen.getByPlaceholderText(m.keyPlaceholder)).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByText(m.keyEmpty)).toBeInTheDocument();
  });

  it("highlights the part of the key that matches the search, in the key's own case", () => {
    const state = step(editorWith({ API_TOKEN: "x" }), { type: "setQuery", text: "tok" });
    render(<VariablesTable rows={rowsOf(state)} dispatch={() => {}} />);
    const mark = document.querySelector("mark");
    expect(mark?.textContent).toBe("TOK");
    expect(mark?.className).toContain("bg-info/40");
  });

  it("the add row has no delete button and its value waits for a key", () => {
    const added = step(editorWith({}), { type: "addRow" });
    const { rerender } = render(<VariablesTable rows={rowsOf(added)} dispatch={() => {}} />);
    expect(screen.queryByRole("button", { name: /delete variable/i })).toBeNull();
    expect(screen.getByRole("textbox", { name: m.valueHeader })).toBeDisabled();

    rerender(<VariablesTable rows={rowsOf(addRowTyping(editorWith({}), "NEW"))} dispatch={() => {}} />);
    expect(screen.getByRole("textbox", { name: m.valueHeader })).toBeEnabled();
  });

  it("the delete button removes its own row", async () => {
    const user = userEvent.setup();
    const state = editorWith({ a: "1", b: "2" });
    const dispatch = vi.fn();
    render(<VariablesTable rows={rowsOf(state)} dispatch={dispatch} />);
    const deletes = screen.getAllByRole("button", { name: /delete variable/i });
    expect(deletes).toHaveLength(2);
    for (const button of deletes) expect(button.className).toContain("group-hover/envrow:opacity-100");
    await user.click(screen.getByRole("button", { name: m.deleteVariableAria("b") }));
    const b = rowsOf(state).find((row) => row.keyText === "b")!;
    expect(dispatch).toHaveBeenCalledWith({ type: "deleteRow", rowId: b.id });
  });

  it("shows a resolve preview row under a value with {{vars}}", async () => {
    const resolveRow = vi.fn(async () => ({
      resolved: "https://api.example.com",
      unresolved_vars: [],
      cycle_chain: null,
      dynamic_vars: [],
    }));
    render(
      <VariablesTable
        rows={rowsOf(editorWith({ "uri-root": "{{notes-api-root}}" }))}
        dispatch={() => {}}
        resolveRow={resolveRow}
        resolveKey="k"
      />,
    );
    expect(await screen.findByText(/→ resolves: https:\/\/api\.example\.com/)).toBeInTheDocument();
    expect(resolveRow).toHaveBeenCalledWith("{{notes-api-root}}");
  });

  it("renders no preview row without a resolveRow prop", () => {
    render(<VariablesTable rows={rowsOf(editorWith({ k: "{{x}}" }))} dispatch={() => {}} />);
    expect(screen.queryByText(/resolves|Unresolved/)).toBeNull();
  });
});
