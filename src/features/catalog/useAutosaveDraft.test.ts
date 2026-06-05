import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

const autosaveDraft = vi.fn().mockResolvedValue(undefined);
vi.mock("./save", () => ({
  autosaveDraft: (...args: unknown[]) => autosaveDraft(...args),
}));

import { useAutosaveDraft } from "./useAutosaveDraft";
import { workflowStore } from "@/features/workflow/store";
import { newStep } from "@/features/workflow/model";

const updateItemContent = vi.fn().mockResolvedValue(undefined);
const step = () => newStep({ address: "h:443", tls: false, service: "p.S", method: "M" });

beforeEach(() => {
  vi.useFakeTimers();
  autosaveDraft.mockClear();
  updateItemContent.mockClear();
  workflowStore.reset();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("useAutosaveDraft", () => {
  it("does not autosave an unbound draft", () => {
    renderHook(() => useAutosaveDraft(updateItemContent, 500));
    act(() => {
      workflowStore.setDraft(step()); // unbound
    });
    act(() => {
      workflowStore.updateDraft({ requestJson: '{"a":1}' });
    });
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(autosaveDraft).not.toHaveBeenCalled();
  });

  it("does not autosave on the bind itself (no edit yet)", () => {
    renderHook(() => useAutosaveDraft(updateItemContent, 500));
    act(() => {
      workflowStore.setDraft(step(), { collectionId: "c1", requestId: "r1" });
    });
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(autosaveDraft).not.toHaveBeenCalled();
  });

  it("debounced-autosaves an origin-bound draft after a content edit", () => {
    renderHook(() => useAutosaveDraft(updateItemContent, 500));
    act(() => {
      workflowStore.setDraft(step(), { collectionId: "c1", requestId: "r1" });
    });
    act(() => {
      workflowStore.updateDraft({ requestJson: '{"a":1}' });
    });
    expect(autosaveDraft).not.toHaveBeenCalled(); // still within debounce window
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(autosaveDraft).toHaveBeenCalledTimes(1);
    expect(autosaveDraft).toHaveBeenCalledWith(
      updateItemContent,
      { collectionId: "c1", requestId: "r1" },
      expect.objectContaining({ requestJson: '{"a":1}' }),
    );
  });

  it("coalesces rapid edits into a single autosave", () => {
    renderHook(() => useAutosaveDraft(updateItemContent, 500));
    act(() => {
      workflowStore.setDraft(step(), { collectionId: "c1", requestId: "r1" });
    });
    act(() => {
      workflowStore.updateDraft({ requestJson: '{"a":1}' });
    });
    act(() => {
      vi.advanceTimersByTime(300);
    });
    act(() => {
      workflowStore.updateDraft({ requestJson: '{"a":2}' });
    });
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(autosaveDraft).not.toHaveBeenCalled(); // timer reset by the 2nd edit
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(autosaveDraft).toHaveBeenCalledTimes(1);
  });
});
