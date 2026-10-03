import * as ipc from "@/ipc/client";
import { workflowStore, type WorkflowState } from "@/features/workflow/store";
import { streamStore } from "./streamStore";

/** Every stream id any step still references: workflow history (all workflows) + the draft. */
export function referencedStreamIds(state: WorkflowState): Set<string> {
  const ids = new Set<string>();
  for (const wf of state.workflows) for (const s of wf.steps) if (s.streamId) ids.add(s.streamId);
  if (state.draft?.streamId) ids.add(state.draft.streamId);
  return ids;
}

/** The one place the frontend frees a Stream store entry: after every workflow-store
 *  transition, diff the referenced stream ids before/after and release each id that
 *  disappeared — re-Open of the same step, step removal, draft replaced/cleared. Core's
 *  `stream_release` is best-effort (the call may already be gone). Returns uninstall. */
export function installStreamReleaseRule(
  release: (id: string) => Promise<void> = (id) => ipc.streamRelease(id),
): () => void {
  let prev = referencedStreamIds(workflowStore.getState());
  return workflowStore.subscribe(() => {
    const next = referencedStreamIds(workflowStore.getState());
    for (const id of prev) {
      if (next.has(id)) continue;
      streamStore.drop(id);
      void release(id).catch(() => {});
    }
    prev = next;
  });
}
