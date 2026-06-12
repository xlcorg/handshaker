import { useSyncExternalStore } from "react";
import { newWorkflow, type Step, type Workflow } from "./model";
import { addStep, setWorkflowEnv as setWorkflowEnvReducer } from "./reducers";
import { envActiveSet } from "@/ipc/client";

export interface DraftOrigin {
  collectionId: string;
  requestId: string;
  /** Display names for the header breadcrumb; absent for legacy/unknown origins. */
  collectionName?: string;
  requestName?: string;
}

const CONTENT_KEYS = ["address", "tls", "service", "method", "auth", "requestJson", "metadata"] as const;

/** True when a draft patch changes saved content (so an unbound draft becomes dirty). */
export function isContentPatch(patch: Partial<Step>): boolean {
  return CONTENT_KEYS.some((k) => k in patch);
}

export interface WorkflowState {
  workflows: Workflow[];
  activeWorkflowId: string;
  draft: Step | null;
  draftOrigin: DraftOrigin | null;
  draftDirty: boolean;
}

function initialState(): WorkflowState {
  const wf = newWorkflow("workflow-1");
  return { workflows: [wf], activeWorkflowId: wf.id, draft: null, draftOrigin: null, draftDirty: false };
}

let state: WorkflowState = initialState();
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

export const workflowStore = {
  getState(): WorkflowState {
    return state;
  },
  subscribe(fn: () => void): () => void {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
  reset() {
    state = initialState();
    emit();
  },
  activeWorkflow(): Workflow {
    return state.workflows.find((w) => w.id === state.activeWorkflowId)!;
  },
  /** Apply a pure transition to the active workflow. */
  update(fn: (wf: Workflow) => Workflow) {
    state = {
      ...state,
      workflows: state.workflows.map((w) =>
        w.id === state.activeWorkflowId ? fn(w) : w,
      ),
    };
    emit();
  },
  setDraft(step: Step | null, origin: DraftOrigin | null = null) {
    let draft = step;
    if (step) {
      const collectionId = origin?.collectionId ?? step.collectionId ?? null;
      // Preserve object identity when the stamp is a no-op (callers rely on `toBe`).
      draft = step.collectionId === collectionId ? step : { ...step, collectionId };
    }
    state = { ...state, draft, draftOrigin: origin, draftDirty: false };
    emit();
  },
  setDraftOrigin(origin: DraftOrigin | null) {
    const draft = state.draft
      ? { ...state.draft, collectionId: origin?.collectionId ?? null }
      : null;
    state = { ...state, draft, draftOrigin: origin, draftDirty: false };
    emit();
  },
  updateDraft(patch: Partial<Step>) {
    if (!state.draft) return;
    const dirty =
      state.draftDirty || (state.draftOrigin === null && isContentPatch(patch));
    state = { ...state, draft: { ...state.draft, ...patch }, draftDirty: dirty };
    emit();
  },
  clearDraft() {
    state = { ...state, draft: null, draftOrigin: null, draftDirty: false };
    emit();
  },
  /** Append a frozen executed snapshot to the active workflow's history. */
  commitExecutedStep(step: Step) {
    workflowStore.update((w) => addStep(w, step));
  },
  createWorkflow(name: string): Workflow {
    const wf = newWorkflow(name);
    state = { ...state, workflows: [...state.workflows, wf], activeWorkflowId: wf.id };
    emit();
    void envActiveSet(wf.envName);
    return wf;
  },
  setWorkflowEnv(name: string | null) {
    workflowStore.update((w) => setWorkflowEnvReducer(w, name));
    void envActiveSet(name);
  },
  /** Set the active workflow's env from a persisted source WITHOUT echoing back to
   * the backend (used to hydrate on startup from envActiveGet). */
  hydrateEnv(name: string | null) {
    workflowStore.update((w) => setWorkflowEnvReducer(w, name));
  },
  setActiveWorkflow(id: string) {
    const next = state.workflows.find((w) => w.id === id);
    if (!next) return;
    state = { ...state, activeWorkflowId: id };
    emit();
    void envActiveSet(next.envName);
  },
};

export function useWorkflowState(): WorkflowState {
  return useSyncExternalStore(workflowStore.subscribe, workflowStore.getState);
}

export function useActiveWorkflow(): Workflow {
  useWorkflowState(); // subscribe
  return workflowStore.activeWorkflow();
}

export function useDraft(): Step | null {
  useWorkflowState(); // subscribe
  return workflowStore.getState().draft;
}

export function useDraftOrigin(): DraftOrigin | null {
  useWorkflowState(); // subscribe
  return workflowStore.getState().draftOrigin;
}

export function useDraftDirty(): boolean {
  useWorkflowState(); // subscribe
  return workflowStore.getState().draftDirty;
}
