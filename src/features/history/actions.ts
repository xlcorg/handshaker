import { newId } from "@/lib/ids";
import type { Step } from "@/features/workflow/model";
import { setView } from "@/features/workflow/reducers";
import { workflowStore } from "@/features/workflow/store";

let rerunId: string | null = null;

export type HistoryMode = "restore" | "rerun";

export function applyHistoryStep(step: Step, mode: HistoryMode): void {
  const id = newId();
  if (mode === "restore") {
    rerunId = null;
    workflowStore.setDraft({ ...step, id, requestId: null }, null);
  } else {
    rerunId = id;
    workflowStore.setDraft(
      {
        ...step,
        id,
        status: "draft",
        outcome: null,
        error: null,
        requestId: null,
        streamId: null,
      },
      null,
    );
  }
  workflowStore.update((w) => setView(w, "focus"));
}

export function takeRerun(id: string): boolean {
  if (rerunId !== id) return false;
  rerunId = null;
  return true;
}
