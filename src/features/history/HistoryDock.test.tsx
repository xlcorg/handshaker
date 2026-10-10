import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { CallRecordIpc, HistoryPageIpc } from "@/ipc/bindings";

const api = vi.hoisted(() => ({
  historyList: vi.fn<() => Promise<HistoryPageIpc>>(),
  historyGet: vi.fn<(id: string) => Promise<CallRecordIpc | null>>(),
}));
vi.mock("@/ipc/client", () => ({ ...api, ipc: api }));

import { messages } from "@/lib/messages";
import { readPrefs, setPref } from "@/lib/use-prefs";
import { HistoryDock } from "./HistoryDock";
import { historyStore } from "./store";
import { callRecord, summary } from "./testFixtures";

const say = summary({ id: "a" });
const lookup = summary({ id: "b", method: "Lookup", ending: { type: "status", code: 5 } });
const watch = summary({ id: "c", kind: "server", method: "Watch", ending: { type: "cancelled" } });
const onOpen = vi.fn();

function renderDock() {
  return render(
    <HistoryDock onOpen={onOpen}>
      <div>WORKSPACE</div>
    </HistoryDock>,
  );
}

async function rowButtons() {
  return screen.findAllByTestId("history-row-open");
}

const detailLabel = () => screen.getByTestId("history-detail").getAttribute("aria-label");

beforeEach(() => {
  vi.clearAllMocks();
  historyStore.reset();
  setPref("historyDock", true);
  api.historyList.mockResolvedValue({ revision: 1, rows: [say, lookup, watch] });
  api.historyGet.mockImplementation((id) => Promise.resolve(callRecord({ id })));
});

describe("HistoryDock rows", () => {
  it("lists core's rows in order with method, status and elapsed", async () => {
    renderDock();
    const rows = await rowButtons();
    expect(rows.map((b) => b.getAttribute("aria-label")?.split(" from ")[0])).toEqual([
      "Open Echo.Say",
      "Open Echo.Lookup",
      "Open Echo.Watch",
    ]);
    expect(rows[1]).toHaveTextContent("NOT_FOUND");
    expect(rows[2]).toHaveTextContent("Cancelled");
    expect(rows[0]).toHaveTextContent("12ms");
    expect(screen.getByTestId("history-dock-toggle")).toHaveTextContent(messages.history.dock.titleWithCount(3));
  });

  it("the row button opens the call on click, Enter and Space", async () => {
    const user = userEvent.setup();
    renderDock();
    const rows = await rowButtons();
    await user.click(rows[1]);
    expect(onOpen).toHaveBeenLastCalledWith("b", "open");

    act(() => rows[0].focus());
    await user.keyboard("{Enter}");
    expect(onOpen).toHaveBeenLastCalledWith("a", "open");
    await user.keyboard(" ");
    expect(onOpen).toHaveBeenCalledTimes(3);
    expect(onOpen).toHaveBeenLastCalledWith("a", "open");
  });

  it("the row container has no click handler of its own", async () => {
    renderDock();
    const rows = await rowButtons();
    fireEvent.click(rows[0].closest("li")!);
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("is one tab stop, and arrows, Home and End move focus and the detail with it", async () => {
    const user = userEvent.setup();
    renderDock();
    const rows = await rowButtons();
    expect(rows.map((b) => b.tabIndex)).toEqual([0, -1, -1]);

    act(() => rows[0].focus());
    expect(detailLabel()).toBe("Echo.Say");
    await user.keyboard("{ArrowDown}");
    expect(document.activeElement).toBe(rows[1]);
    expect(detailLabel()).toBe("Echo.Lookup");
    expect(rows.map((b) => b.tabIndex)).toEqual([-1, 0, -1]);
    await user.keyboard("{End}");
    expect(document.activeElement).toBe(rows[2]);
    await user.keyboard("{ArrowDown}");
    expect(document.activeElement).toBe(rows[2]);
    await user.keyboard("{Home}");
    expect(document.activeElement).toBe(rows[0]);
    await user.keyboard("{ArrowUp}");
    expect(document.activeElement).toBe(rows[0]);
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("Re-run on a row and in the detail asks for a rerun of that call", async () => {
    const user = userEvent.setup();
    renderDock();
    await rowButtons();
    await user.click(screen.getAllByTestId("history-row-rerun")[2]);
    expect(onOpen).toHaveBeenLastCalledWith("c", "rerun");

    await user.click(screen.getAllByTestId("history-row-open")[1]);
    await user.click(screen.getByTestId("history-detail-rerun"));
    expect(onOpen).toHaveBeenLastCalledWith("b", "rerun");
  });
});

describe("HistoryDock filter", () => {
  it("chips and the text filter narrow the rows", async () => {
    const user = userEvent.setup();
    renderDock();
    await rowButtons();
    const labels = () => screen.queryAllByTestId("history-row-open").map((b) => b.textContent);

    await user.click(screen.getByTestId("history-chip-failed"));
    expect(screen.getByTestId("history-chip-failed")).toHaveAttribute("aria-pressed", "true");
    expect(labels()).toHaveLength(2);
    expect(labels().join(" ")).not.toContain("Echo.Say");

    await user.click(screen.getByTestId("history-chip-ok"));
    expect(labels()).toHaveLength(1);
    expect(labels()[0]).toContain("Echo.Say");

    await user.click(screen.getByTestId("history-chip-all"));
    fireEvent.change(screen.getByTestId("history-filter"), { target: { value: "watch" } });
    expect(labels()).toHaveLength(1);
    expect(labels()[0]).toContain("Echo.Watch");

    fireEvent.change(screen.getByTestId("history-filter"), { target: { value: "watch-nothing" } });
    expect(labels()).toHaveLength(0);
    expect(screen.getByText(messages.history.dock.emptyFiltered)).toBeInTheDocument();
  });

  it("a selected row the filter hides takes its detail with it", async () => {
    const user = userEvent.setup();
    renderDock();
    await user.click((await rowButtons())[0]);
    expect(detailLabel()).toBe("Echo.Say");
    await user.click(screen.getByTestId("history-chip-failed"));
    expect(screen.queryByTestId("history-detail")).toBeNull();
  });
});

describe("HistoryDock states", () => {
  it("says so while loading, when the list fails, and when there are no calls", async () => {
    let resolve!: (p: HistoryPageIpc) => void;
    api.historyList.mockReturnValueOnce(new Promise((r) => (resolve = r)));
    const { unmount } = renderDock();
    expect(screen.getByText(messages.history.dock.loading)).toBeInTheDocument();
    await act(async () => resolve({ revision: 1, rows: [] }));
    expect(screen.getByText(messages.history.dock.empty)).toBeInTheDocument();
    unmount();

    historyStore.reset();
    api.historyList.mockRejectedValueOnce(new Error("io"));
    renderDock();
    expect(await screen.findByText(messages.history.dock.loadFailed)).toBeInTheDocument();
  });

  it("starts expanded, and the toggle collapses it to its header with the workspace kept", async () => {
    const user = userEvent.setup();
    renderDock();
    const toggle = screen.getByTestId("history-dock-toggle");
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    await rowButtons();

    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(readPrefs().historyDock).toBe(false);
    expect(screen.queryByTestId("history-row-open")).toBeNull();
    expect(screen.queryByTestId("history-filter")).toBeNull();
    expect(within(screen.getByTestId("history-dock")).getByText(messages.history.dock.titleWithCount(3))).toBeInTheDocument();
    expect(screen.getByText("WORKSPACE")).toBeInTheDocument();

    await user.click(toggle);
    expect(readPrefs().historyDock).toBe(true);
    expect(await rowButtons()).toHaveLength(3);
  });
});
