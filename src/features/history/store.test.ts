import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CallRecordIpc, HistoryPageIpc } from "@/ipc/bindings";

const mocks = vi.hoisted(() => ({
  historyList: vi.fn<() => Promise<HistoryPageIpc>>(),
  historyRecord: vi.fn<(r: CallRecordIpc) => Promise<HistoryPageIpc>>(),
  historyGet: vi.fn<(id: string) => Promise<CallRecordIpc | null>>(),
  historyClear: vi.fn<() => Promise<HistoryPageIpc>>(),
}));
vi.mock("@/ipc/client", () => ({ ...mocks, ipc: mocks }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), info: vi.fn() } }));

import { toast } from "sonner";
import { historyStore } from "./store";
import { callRecord, summary } from "./testFixtures";
import { messages } from "@/lib/messages";

const older = summary({ id: "older", started_at_ms: 1 });
const newer = summary({ id: "newer", started_at_ms: 2 });

async function hydrated() {
  historyStore.subscribe(() => {});
  await vi.waitFor(() => expect(historyStore.getState().phase).not.toBe("loading"));
}

beforeEach(() => {
  vi.clearAllMocks();
  historyStore.reset();
});

describe("historyStore", () => {
  it("the first subscriber hydrates once, and rows keep core's order", async () => {
    mocks.historyList.mockResolvedValue({ revision: 1, rows: [newer, older] });
    historyStore.subscribe(() => {});
    await hydrated();
    expect(mocks.historyList).toHaveBeenCalledTimes(1);
    expect(historyStore.getState()).toEqual({ phase: "ready", revision: 1, rows: [newer, older] });
  });

  it("a slow list never rolls back an append that landed after it", async () => {
    let resolveList!: (p: HistoryPageIpc) => void;
    mocks.historyList.mockReturnValue(new Promise((r) => (resolveList = r)));
    mocks.historyRecord.mockResolvedValue({ revision: 2, rows: [newer, older] });
    historyStore.subscribe(() => {});

    await historyStore.record(callRecord({ id: "newer" }));
    resolveList({ revision: 1, rows: [older] });
    await Promise.resolve();

    expect(historyStore.getState()).toEqual({ phase: "ready", revision: 2, rows: [newer, older] });
  });

  it("a refused record toasts, resolves, and leaves the rows", async () => {
    mocks.historyList.mockResolvedValue({ revision: 1, rows: [older] });
    await hydrated();
    mocks.historyRecord.mockRejectedValue({ type: "Persistence", message: "record too large" });

    await expect(historyStore.record(callRecord())).resolves.toBeUndefined();

    expect(toast.error).toHaveBeenCalledWith(messages.history.toast.recordFailed);
    expect(historyStore.getState()).toEqual({ phase: "ready", revision: 1, rows: [older] });
  });

  it("a failed list shows failed until a record lands", async () => {
    mocks.historyList.mockRejectedValue({ type: "Persistence", message: "io" });
    await hydrated();
    expect(historyStore.getState()).toEqual({ phase: "failed" });

    mocks.historyRecord.mockResolvedValue({ revision: 2, rows: [newer] });
    await historyStore.record(callRecord({ id: "newer" }));
    expect(historyStore.getState()).toEqual({ phase: "ready", revision: 2, rows: [newer] });
  });

  it("load caches a record until its row leaves the page, and never rejects", async () => {
    mocks.historyList.mockResolvedValue({ revision: 1, rows: [summary()] });
    await hydrated();
    mocks.historyGet.mockResolvedValueOnce(callRecord()).mockResolvedValueOnce(null);

    expect(await historyStore.load("call-1")).toEqual(callRecord());
    expect(await historyStore.load("call-1")).toEqual(callRecord());
    expect(mocks.historyGet).toHaveBeenCalledTimes(1);

    mocks.historyRecord.mockResolvedValue({ revision: 2, rows: [newer] });
    await historyStore.record(callRecord({ id: "newer" }));
    expect(await historyStore.load("call-1")).toBeNull();
    expect(mocks.historyGet).toHaveBeenCalledTimes(2);

    mocks.historyGet.mockRejectedValueOnce({ type: "InvalidTarget", message: "bad call id" });
    expect(await historyStore.load("nope")).toBeNull();
  });

  it("clear applies an empty page, and a later load of the old id is null", async () => {
    mocks.historyList.mockResolvedValue({ revision: 1, rows: [older] });
    await hydrated();
    mocks.historyClear.mockResolvedValue({ revision: 2, rows: [] });

    await historyStore.clear();

    expect(historyStore.getState()).toEqual({ phase: "ready", revision: 2, rows: [] });
    mocks.historyGet.mockResolvedValue(callRecord({ id: "older" }));
    expect(await historyStore.load("older")).toBeNull();
  });

  it("an in-flight record with an older revision after clear does not bring rows back", async () => {
    mocks.historyList.mockResolvedValue({ revision: 1, rows: [older] });
    await hydrated();
    let resolveRecord!: (page: HistoryPageIpc) => void;
    mocks.historyRecord.mockReturnValue(new Promise((resolve) => (resolveRecord = resolve)));
    const pending = historyStore.record(callRecord({ id: "newer" }));
    mocks.historyClear.mockResolvedValue({ revision: 3, rows: [] });

    await historyStore.clear();
    resolveRecord({ revision: 2, rows: [newer, older] });
    await pending;

    expect(historyStore.getState()).toEqual({ phase: "ready", revision: 3, rows: [] });
  });

  it("a rejected clear toasts, resolves, and keeps the rows", async () => {
    mocks.historyList.mockResolvedValue({ revision: 1, rows: [older] });
    await hydrated();
    mocks.historyClear.mockRejectedValue({ type: "Persistence", message: "clear history" });

    await expect(historyStore.clear()).resolves.toBeUndefined();

    expect(toast.error).toHaveBeenCalledWith(messages.history.toast.clearFailed);
    expect(historyStore.getState()).toEqual({ phase: "ready", revision: 1, rows: [older] });
  });

  it("a get that resolves after clear does not cache the record", async () => {
    mocks.historyList.mockResolvedValue({ revision: 1, rows: [older] });
    await hydrated();
    let resolveGet!: (record: CallRecordIpc | null) => void;
    mocks.historyGet.mockReturnValue(new Promise((resolve) => (resolveGet = resolve)));
    const pending = historyStore.load("older");
    mocks.historyClear.mockResolvedValue({ revision: 2, rows: [] });

    await historyStore.clear();
    resolveGet(callRecord({ id: "older" }));

    expect(await pending).toBeNull();
    expect(await historyStore.load("older")).toBeNull();
    expect(mocks.historyGet).toHaveBeenCalledTimes(2);
  });
});
