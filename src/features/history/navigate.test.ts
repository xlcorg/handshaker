import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CallRecordIpc, CollectionIpc, HistoryPageIpc, SendReportIpc } from "@/ipc/bindings";

const mocks = vi.hoisted(() => {
  const api = {
    historyGet: vi.fn<(id: string) => Promise<CallRecordIpc | null>>(),
    historyRecord: vi.fn<(r: CallRecordIpc) => Promise<HistoryPageIpc>>(),
    grpcSend: vi.fn<(...a: unknown[]) => Promise<SendReportIpc>>(),
    grpcCancel: vi.fn().mockResolvedValue(undefined),
    streamOpen: vi.fn<(...a: unknown[]) => Promise<void>>(),
    appSettingsSet: vi.fn().mockResolvedValue(undefined),
    envActiveSet: vi.fn().mockResolvedValue(undefined),
  };
  return { api, bumpUsage: vi.fn(() => Promise.resolve()) };
});
vi.mock("@/ipc/client", () => ({ ...mocks.api, ipc: mocks.api }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), info: vi.fn() } }));

import { toast } from "sonner";
import { openHistoryCall } from "./navigate";
import { historyStore } from "./store";
import { callRecord, collection, savedRequest } from "./testFixtures";
import { workflowStore } from "@/features/workflow/store";
import { newStep } from "@/features/workflow/model";
import { needsDiscardConfirm } from "@/features/catalog/discardGuard";
import { resetUiState } from "@/features/catalog/uiState";
import { messages } from "@/lib/messages";

const report: SendReportIpc = {
  outcome: { status_code: 0, status_message: "", response_json: "{}", trailing_metadata: {}, status_details: [], elapsed_ms: 3 },
  auth_used: { kind: "none" },
  tls_used: false,
};

/** WorkflowApp's guardedRun with the discard dialog held open: `confirm` is Discard (or a
 *  Save that already reloaded the catalog), `cancel` is Cancel. */
function dialogGuard() {
  let pending: (() => void) | null = null;
  return {
    guard: (action: () => void) => {
      const st = workflowStore.getState();
      if (needsDiscardConfirm(st.draftOrigin, st.draftDirty)) pending = action;
      else action();
    },
    held: () => pending !== null,
    confirm: () => pending?.(),
    cancel: () => (pending = null),
  };
}

let tree: CollectionIpc[] = [];
function deps(guard: (action: () => void) => void = (a) => a()) {
  return { tree: () => tree, guard, revealFocus: vi.fn(), bumpUsage: mocks.bumpUsage };
}

function dirtyUnboundDraft() {
  const step = newStep({ address: "mine:1", service: "s", method: "m" });
  workflowStore.setDraft(step);
  workflowStore.updateDraft(step.id, { requestJson: '{"unsaved":true}' });
  return workflowStore.getState().draft!;
}

const draft = () => workflowStore.getState().draft!;

beforeEach(() => {
  vi.clearAllMocks();
  workflowStore.reset();
  historyStore.reset();
  resetUiState();
  tree = [collection("c1", [savedRequest("r1", "Say hello")])];
  mocks.api.historyGet.mockResolvedValue(callRecord());
  mocks.api.historyRecord.mockResolvedValue({ revision: 2, rows: [] });
});

describe("openHistoryCall open", () => {
  it("opens Focus on the record's request, bound to its origin, and never sends", async () => {
    workflowStore.update((w) => ({ ...w, view: "list" }));
    const d = deps();

    await openHistoryCall("call-1", "open", d);

    expect(d.revealFocus).toHaveBeenCalledTimes(1);
    expect(workflowStore.activeWorkflow().view).toBe("focus");
    expect(draft()).toMatchObject({
      address: "{{host}}:50051", service: "echo.v1.Echo", method: "Say", requestJson: '{"text":"hi"}',
      collectionId: "c1", status: "draft",
    });
    expect(workflowStore.getState().draftOrigin).toEqual({ collectionId: "c1", requestId: "r1", requestName: "Say hello" });
    expect(workflowStore.getState().draftDirty).toBe(false);
    expect(mocks.api.appSettingsSet).toHaveBeenCalledWith(
      expect.objectContaining({ active_request: { collection_id: "c1", item_id: "r1" } }),
    );
    expect(mocks.api.grpcSend).not.toHaveBeenCalled();
    expect(mocks.api.streamOpen).not.toHaveBeenCalled();
  });

  it("a gone origin opens an unbound draft with the notice and no active_request", async () => {
    tree = [];
    await openHistoryCall("call-1", "open", deps());
    expect(draft()).toMatchObject({ collectionId: null, requestJson: '{"text":"hi"}' });
    expect(workflowStore.getState().draftOrigin).toBeNull();
    expect(toast.info).toHaveBeenCalledWith(messages.history.notice.originMissing);
    expect(mocks.api.appSettingsSet).not.toHaveBeenCalled();
  });

  it("a missing record toasts and changes nothing", async () => {
    const before = dirtyUnboundDraft();
    mocks.api.historyGet.mockResolvedValue(null);
    const guard = vi.fn();
    await openHistoryCall("gone", "open", deps(guard));
    expect(toast.error).toHaveBeenCalledWith(messages.history.toast.unavailable);
    expect(guard).not.toHaveBeenCalled();
    expect(draft()).toBe(before);
  });
});

describe("openHistoryCall through the discard guard", () => {
  it("a dirty unbound draft defers; Cancel leaves it untouched", async () => {
    const before = dirtyUnboundDraft();
    const g = dialogGuard();
    await openHistoryCall("call-1", "rerun", deps(g.guard));
    expect(g.held()).toBe(true);
    g.cancel();
    expect(draft()).toBe(before);
    expect(mocks.api.grpcSend).not.toHaveBeenCalled();
  });

  it("Discard applies the open", async () => {
    dirtyUnboundDraft();
    const g = dialogGuard();
    await openHistoryCall("call-1", "open", deps(g.guard));
    g.confirm();
    expect(draft()).toMatchObject({ requestJson: '{"text":"hi"}', collectionId: "c1" });
  });

  it("the plan reads the tree when the action runs, so a Save's reload is visible", async () => {
    dirtyUnboundDraft();
    tree = [];
    const g = dialogGuard();
    await openHistoryCall("call-1", "open", deps(g.guard));
    tree = [collection("c1", [savedRequest("r1", "Say hello")])];
    g.confirm();
    expect(workflowStore.getState().draftOrigin).toMatchObject({ collectionId: "c1", requestId: "r1" });
    expect(toast.info).not.toHaveBeenCalled();
  });
});

describe("openHistoryCall rerun", () => {
  it("sends the opened draft exactly once, and the result lands on it", async () => {
    mocks.api.grpcSend.mockResolvedValue(report);
    await openHistoryCall("call-1", "rerun", deps());
    await vi.waitFor(() => expect(draft().status).toBe("ok"));
    expect(mocks.api.grpcSend).toHaveBeenCalledTimes(1);
    expect(mocks.api.grpcSend.mock.calls[0][0]).toMatchObject({ address_template: "{{host}}:50051", body_template: '{"text":"hi"}' });
    expect(mocks.api.historyRecord).toHaveBeenCalledTimes(1);
    expect(mocks.bumpUsage).toHaveBeenCalledWith("c1", "r1", expect.any(Number));
  });

  it("re-runs a stream with the kind it ran as", async () => {
    mocks.api.historyGet.mockResolvedValue(
      callRecord({
        outcome: { type: "stream", kind: "server", headers: null, messages: [], omitted_messages: 0, end: { type: "cancelled" } },
      }),
    );
    mocks.api.streamOpen.mockImplementation(() => new Promise(() => {}));
    await openHistoryCall("call-1", "rerun", deps());
    await vi.waitFor(() => expect(mocks.api.streamOpen).toHaveBeenCalledTimes(1));
    expect(mocks.api.streamOpen.mock.calls[0][3]).toBe("server");
    expect(mocks.api.grpcSend).not.toHaveBeenCalled();
  });
});
