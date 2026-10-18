import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { messages } from "@/lib/messages";

import { storedName } from "./envDraft";
import {
  editorStep,
  initEditor,
  selectView,
  type CellRef,
  type EditorState,
  type PaneAction,
} from "./envEditor";
import type { SortMode } from "./varView";
import { VariablesTable } from "./VariablesTable";

const m = messages.envs.editor;

const hidden = { kind: "hidden" } as const;

function editorWith(vars: Record<string, string>): EditorState {
  const name = storedName("dev");
  return initEditor(
    { name, color: null, variables: Object.entries(vars), index: 0 },
    [{ name }],
  );
}

function step(state: EditorState, ...actions: PaneAction[]): EditorState {
  return actions.reduce(
    (s, action) => editorStep(s, action, { sort: "oldest" }).state,
    state,
  );
}

function tableOf(state: EditorState, sort: SortMode = "oldest") {
  return selectView(state, { sort, status: hidden }).table;
}

function cellOf(
  state: EditorState,
  kind: CellRef["kind"],
  key: string,
): CellRef {
  const row = tableOf(state).rows.find((r) => r.key.text === key);
  if (!row) throw new Error(`no row ${key}`);
  return { kind, rowId: row.id };
}

function opened(
  state: EditorState,
  kind: CellRef["kind"],
  key: string,
): { state: EditorState; cell: CellRef } {
  const cell = cellOf(state, kind, key);
  return { state: step(state, { type: "openCell", cell }), cell };
}

describe("VariablesTable", () => {
  it("shows closed cells as buttons and opens the one clicked", async () => {
    const user = userEvent.setup();
    const state = editorWith({ token: "abc123" });
    const dispatch = vi.fn();
    render(<VariablesTable table={tableOf(state)} dispatch={dispatch} />);
    expect(screen.queryByRole("textbox")).toBeNull();
    await user.click(screen.getByRole("button", { name: "abc123" }));
    expect(dispatch).toHaveBeenCalledWith({
      type: "openCell",
      cell: cellOf(state, "value", "token"),
    });
  });

  it("an open value is a textarea that commits on Enter and keeps Shift+Enter as a newline", () => {
    const { state, cell } = opened(
      editorWith({ token: "abc" }),
      "value",
      "token",
    );
    const dispatch = vi.fn();
    render(<VariablesTable table={tableOf(state)} dispatch={dispatch} />);
    const editor = screen.getByRole("textbox", { name: m.valueHeader });
    expect(editor.tagName).toBe("TEXTAREA");
    fireEvent.keyDown(editor, { key: "Enter", shiftKey: true });
    expect(dispatch).not.toHaveBeenCalled();
    fireEvent.keyDown(editor, { key: "Enter" });
    expect(dispatch).toHaveBeenCalledWith({
      type: "commitCell",
      cell,
      via: "enter",
    });
  });

  it("an open key is a single-line input that commits on Enter and on blur", () => {
    const { state, cell } = opened(
      editorWith({ token: "abc" }),
      "key",
      "token",
    );
    const dispatch = vi.fn();
    render(<VariablesTable table={tableOf(state)} dispatch={dispatch} />);
    const editor = screen.getByRole("textbox", { name: m.keyLabel });
    expect(editor.tagName).toBe("INPUT");
    fireEvent.keyDown(editor, { key: "Enter" });
    fireEvent.blur(editor);
    expect(dispatch.mock.calls).toEqual([
      [{ type: "commitCell", cell, via: "enter" }],
      [{ type: "commitCell", cell, via: "blur" }],
    ]);
  });

  it("names a duplicate key next to both rows", () => {
    const start = editorWith({ token: "a", other: "b" });
    const cell = cellOf(start, "key", "other");
    const state = step(
      start,
      { type: "openCell", cell },
      { type: "typeCell", cell, text: "token" },
      { type: "commitCell", cell, via: "blur" },
    );
    render(<VariablesTable table={tableOf(state)} dispatch={() => {}} />);
    expect(screen.getAllByText(m.keyDuplicate)).toHaveLength(2);
  });

  it("highlights the part of the key that matches the search, in the key's own case", () => {
    const state = step(editorWith({ API_TOKEN: "x" }), {
      type: "setQuery",
      text: "tok",
    });
    render(<VariablesTable table={tableOf(state)} dispatch={() => {}} />);
    const mark = document.querySelector("mark");
    expect(mark?.textContent).toBe("TOK");
  });

  it("renders the add row last, with Check and X and no delete control", async () => {
    const user = userEvent.setup();
    const state = step(editorWith({ b: "2", a: "1" }), { type: "addRow" });
    const dispatch = vi.fn();
    render(
      <VariablesTable table={tableOf(state, "name-asc")} dispatch={dispatch} />,
    );
    const rows = screen.getAllByRole("row").slice(1);
    expect(
      rows.map((row) => row.querySelector("input, button")?.textContent ?? ""),
    ).toEqual(["a", "b", ""]);
    expect(screen.getByPlaceholderText(m.keyPlaceholder)).toBe(
      rows[2].querySelector("input"),
    );
    expect(
      screen.getAllByRole("button", { name: /delete variable/i }),
    ).toHaveLength(2);
    await user.click(screen.getByRole("button", { name: m.commitDraftAria }));
    await user.click(screen.getByRole("button", { name: m.cancelDraftAria }));
    expect(dispatch.mock.calls).toEqual([
      [{ type: "commitDraft" }],
      [{ type: "cancelDraft" }],
    ]);
  });

  it("the delete button names its key and removes its own row", async () => {
    const user = userEvent.setup();
    const state = editorWith({ a: "1", b: "2" });
    const dispatch = vi.fn();
    render(<VariablesTable table={tableOf(state)} dispatch={dispatch} />);
    const remove = screen.getByRole("button", {
      name: m.deleteVariableAria("b"),
    });
    expect(remove).toHaveAttribute("title", m.deleteVariableTooltip);
    await user.click(remove);
    expect(dispatch).toHaveBeenCalledWith({
      type: "deleteRow",
      rowId: cellOf(state, "key", "b").rowId,
    });
  });

  it("the VARIABLE header reports the name sort and toggles it", async () => {
    const user = userEvent.setup();
    const dispatch = vi.fn();
    const state = editorWith({ a: "1" });
    const { rerender } = render(
      <VariablesTable table={tableOf(state, "oldest")} dispatch={dispatch} />,
    );
    const header = screen.getByRole("columnheader", { name: m.variableHeader });
    expect(header).toHaveAttribute("aria-sort", "none");
    await user.click(screen.getByRole("button", { name: m.variableHeader }));
    expect(dispatch).toHaveBeenCalledWith({ type: "toggleNameSort" });
    rerender(
      <VariablesTable
        table={tableOf(state, "name-desc")}
        dispatch={dispatch}
      />,
    );
    expect(header).toHaveAttribute("aria-sort", "descending");
  });

  it("previews resolution only under an open value that has {{vars}}", async () => {
    const resolveRow = vi.fn(async () => ({
      resolved: "https://api.example.com",
      unresolved_vars: [],
      cycle_chain: null,
      dynamic_vars: [],
    }));
    const closed = editorWith({ "uri-root": "{{notes-api-root}}" });
    const { rerender } = render(
      <VariablesTable
        table={tableOf(closed)}
        dispatch={() => {}}
        resolveRow={resolveRow}
        resolveKey="k"
      />,
    );
    expect(screen.queryByText(/resolves/)).toBeNull();
    const { state } = opened(closed, "value", "uri-root");
    rerender(
      <VariablesTable
        table={tableOf(state)}
        dispatch={() => {}}
        resolveRow={resolveRow}
        resolveKey="k"
      />,
    );
    expect(
      await screen.findByText(/→ resolves: https:\/\/api\.example\.com/),
    ).toBeInTheDocument();
    expect(resolveRow).toHaveBeenCalledWith("{{notes-api-root}}");
  });
});
