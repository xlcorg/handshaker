import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CallRecordIpc, HistoryPageIpc } from "@/ipc/bindings";

const mocks = vi.hoisted(() => ({
  historyList: vi.fn<() => Promise<HistoryPageIpc>>(),
  historyRecord: vi.fn<(r: CallRecordIpc) => Promise<HistoryPageIpc>>(),
  historyGet: vi.fn<(id: string) => Promise<CallRecordIpc | null>>(),
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
});
