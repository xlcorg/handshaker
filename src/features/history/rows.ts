import { useMemo, useSyncExternalStore } from "react";
import type { Step } from "@/features/workflow/model";
import { summarizeStep, type StepSummary } from "@/features/workflow/stepView";
import { useActiveWorkflow } from "@/features/workflow/store";
import { streamStore, type StreamState } from "@/features/stream/streamStore";
import { seenAt } from "./seenAt";

export interface HistoryHit {
  step: Step;
  summary: StepSummary;
  seenMs: number;
}

export type HistoryToneFilter = "all" | "ok" | "failed";

export function historyHits(steps: Step[], streams: StreamState): HistoryHit[] {
  const hits: HistoryHit[] = [];
  for (let i = steps.length - 1; i >= 0; i--) {
    const step = steps[i];
    const entry = step.streamId ? (streams.get(step.streamId) ?? null) : null;
    hits.push({
      step,
      summary: summarizeStep(step, i, entry),
      seenMs: seenAt(step.id),
    });
  }
  return hits;
}

export function hitMatches(
  hit: HistoryHit,
  query: string,
  tone: HistoryToneFilter,
): boolean {
  if (tone === "ok" && hit.summary.tone !== "ok") return false;
  if (
    tone === "failed" &&
    hit.summary.tone !== "error" &&
    hit.step.status !== "cancelled"
  )
    return false;
  const q = query.trim().toLowerCase();
  if (q.length === 0) return true;
  const hay =
    `${hit.step.service}\n${hit.step.method}\n${hit.step.address}\n${hit.summary.statusText}`.toLowerCase();
  return hay.includes(q);
}

export function useHistoryHits(): HistoryHit[] {
  const wf = useActiveWorkflow();
  const streams = useSyncExternalStore(
    streamStore.subscribe,
    streamStore.getState,
  );
  return useMemo(() => historyHits(wf.steps, streams), [wf.steps, streams]);
}
