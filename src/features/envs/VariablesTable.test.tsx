import { describe, it, expect, vi } from "vitest";
import { act, render, screen, fireEvent } from "@testing-library/react";
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

  const long =
    "super-long-secret-value-that-should-remain-fully-visible-abcdefghijklmnopqrstuvwxyz0123456789";

  function classes(el: Element): string[] {
    return (el.getAttribute("class") ?? "").split(/\s+/);
  }

  async function settle() {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }

  function collapsedLine(): HTMLElement {
    const line = document.querySelector("[data-collapsed-value]");
    if (!(line instanceof HTMLElement)) throw new Error("no collapsed value");
    return line;
  }

  it("shows one ellipsized line for an unfocused new-variable value", () => {
    const state = step(
      editorWith({}),
      { type: "addRow" },
      { type: "typeDraft", part: "key", text: "API_TOKEN" },
      { type: "typeDraft", part: "value", text: long },
    );
    render(<VariablesTable table={tableOf(state)} dispatch={() => {}} />);
    const editor = screen.getByRole("textbox", { name: m.valueHeader });
    const line = collapsedLine();
    expect(editor).toHaveValue(long);
    expect(editor).not.toHaveAttribute("wrap", "off");
    expect(editor.style.height).toBe("");
    expect(classes(editor)).toContain("h-7");
    expect(classes(editor)).toContain("overflow-hidden");
    expect(editor.className).not.toContain("overflow-x-auto");
    expect(editor.className).not.toContain("overflow-y-auto");
    expect(line.textContent).toBe(long);
    expect(classes(line)).toContain("line-clamp-1");
    expect(line.className).not.toContain("whitespace-pre-wrap");
  });

  it("wraps a focused new-variable value and collapses it again on blur", async () => {
    const proto = HTMLTextAreaElement.prototype;
    const scroll = Object.getOwnPropertyDescriptor(proto, "scrollHeight");
    const offset = Object.getOwnPropertyDescriptor(proto, "offsetHeight");
    const client = Object.getOwnPropertyDescriptor(proto, "clientHeight");
    Object.defineProperty(proto, "scrollHeight", {
      configurable: true,
      get: () => 80,
    });
    Object.defineProperty(proto, "offsetHeight", {
      configurable: true,
      get: () => 30,
    });
    Object.defineProperty(proto, "clientHeight", {
      configurable: true,
      get: () => 28,
    });
    try {
      const state = step(
        editorWith({}),
        { type: "addRow" },
        { type: "typeDraft", part: "value", text: long },
      );
      render(<VariablesTable table={tableOf(state)} dispatch={() => {}} />);
      const editor = screen.getByRole("textbox", { name: m.valueHeader });
      expect(editor.style.height).toBe("");
      act(() => {
        editor.focus();
      });
      expect(document.querySelector("[data-collapsed-value]")).toBeNull();
      expect(editor).toHaveValue(long);
      expect(editor.className).toContain("whitespace-pre-wrap");
      expect(editor.className).toContain("break-all");
      expect(editor.style.height).toBe("82px");
      expect(editor.className).toContain("overflow-hidden");
      expect(editor.className).not.toContain("overflow-y-auto");
      act(() => {
        editor.blur();
      });
      await settle();
      const line = collapsedLine();
      expect(line.textContent).toBe(long);
      expect(classes(line)).toContain("line-clamp-1");
      expect(line.className).not.toContain("whitespace-pre-wrap");
      expect(editor.style.height).toBe("");
    } finally {
      if (scroll) Object.defineProperty(proto, "scrollHeight", scroll);
      if (offset) Object.defineProperty(proto, "offsetHeight", offset);
      if (client) Object.defineProperty(proto, "clientHeight", client);
    }
  });

  it("scrolls a focused value taller than the cap vertically only", () => {
    const proto = HTMLTextAreaElement.prototype;
    const scroll = Object.getOwnPropertyDescriptor(proto, "scrollHeight");
    const offset = Object.getOwnPropertyDescriptor(proto, "offsetHeight");
    const client = Object.getOwnPropertyDescriptor(proto, "clientHeight");
    Object.defineProperty(proto, "scrollHeight", {
      configurable: true,
      get: () => 400,
    });
    Object.defineProperty(proto, "offsetHeight", {
      configurable: true,
      get: () => 30,
    });
    Object.defineProperty(proto, "clientHeight", {
      configurable: true,
      get: () => 28,
    });
    try {
      const state = step(
        editorWith({}),
        { type: "addRow" },
        { type: "typeDraft", part: "value", text: "x".repeat(400) },
      );
      render(<VariablesTable table={tableOf(state)} dispatch={() => {}} />);
      const editor = screen.getByRole("textbox", { name: m.valueHeader });
      expect(editor.style.height).toBe("");
      act(() => {
        editor.focus();
      });
      expect(editor).toHaveValue("x".repeat(400));
      expect(editor.style.height).toBe("168px");
      expect(editor.className).toContain("overflow-y-auto");
      expect(editor.className).toContain("overflow-x-hidden");
      expect(editor.className).not.toContain("overflow-x-auto");
    } finally {
      if (scroll) Object.defineProperty(proto, "scrollHeight", scroll);
      if (offset) Object.defineProperty(proto, "offsetHeight", offset);
      if (client) Object.defineProperty(proto, "clientHeight", client);
    }
  });

  it("shows a saved long value as one ellipsized line, wraps it while focused, and collapses on blur", async () => {
    render(
      <VariablesTable
        table={tableOf(editorWith({ API_TOKEN: long }))}
        dispatch={() => {}}
      />,
    );
    const button = screen.getByRole("button", { name: long });
    const closed = collapsedLine();
    expect(closed.textContent).toBe(long);
    expect(classes(closed)).toContain("line-clamp-1");
    expect(closed.className).not.toContain("whitespace-pre-wrap");
    expect(classes(button)).toContain("h-7");
    expect(classes(button)).not.toContain("min-h-7");
    act(() => {
      button.focus();
    });
    expect(document.querySelector("[data-collapsed-value]")).toBeNull();
    const open = button.querySelector("span");
    expect(open?.textContent).toBe(long);
    expect(open?.className).toContain("whitespace-pre-wrap");
    expect(open?.className).not.toContain("line-clamp-1");
    expect(classes(button)).toContain("min-h-7");
    act(() => {
      button.blur();
    });
    await settle();
    const again = collapsedLine();
    expect(again.textContent).toBe(long);
    expect(classes(again)).toContain("line-clamp-1");
    expect(again.className).not.toContain("whitespace-pre-wrap");
    expect(classes(button)).toContain("h-7");
  });

  it("collapses a saved row that reused the focused draft id", async () => {
    const draft = step(
      editorWith({}),
      { type: "addRow" },
      { type: "typeDraft", part: "key", text: "TOKEN" },
      { type: "typeDraft", part: "value", text: long },
    );
    const { rerender } = render(
      <VariablesTable table={tableOf(draft)} dispatch={() => {}} />,
    );
    act(() => {
      screen.getByRole("textbox", { name: m.valueHeader }).focus();
    });
    expect(document.querySelector("[data-value-expanded='true']")).not.toBeNull();
    rerender(
      <VariablesTable
        table={tableOf(step(draft, { type: "commitDraft" }))}
        dispatch={() => {}}
      />,
    );
    const line = collapsedLine();
    expect(line.textContent).toBe(long);
    expect(classes(line)).toContain("line-clamp-1");
    expect(line.className).not.toContain("whitespace-pre-wrap");
    expect(document.querySelector("[data-value-expanded='true']")).toBeNull();
  });

  it("keeps the row expanded until the pointer is released", async () => {
    render(
      <VariablesTable
        table={tableOf(editorWith({ API_TOKEN: long, OTHER: "short" }))}
        dispatch={() => {}}
      />,
    );
    const button = screen.getByRole("button", { name: long });
    act(() => {
      button.focus();
    });
    expect(button.querySelector("span")?.className).toContain(
      "whitespace-pre-wrap",
    );
    act(() => {
      fireEvent.pointerDown(window);
      button.blur();
    });
    expect(button.querySelector("span")?.className).toContain(
      "whitespace-pre-wrap",
    );
    act(() => {
      fireEvent.pointerUp(window);
    });
    await settle();
    expect(classes(collapsedLine())).toContain("line-clamp-1");
  });
});
