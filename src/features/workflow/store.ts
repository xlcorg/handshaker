import { useSyncExternalStore } from "react";
import { newWorkflow, type Step, type Workflow } from "./model";
import { addStep, setWorkflowEnv as setWorkflowEnvReducer } from "./reducers";
import { envActiveSet } from "@/ipc/client";

export interface WorkflowState {
  workflows: Workflow[];
  activeWorkflowId: string;
  draft: Step | null;
}

function initialState(): WorkflowState {
  const wf = newWorkflow("workflow-1");
  return { workflows: [wf], activeWorkflowId: wf.id, draft: null };
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
  setDraft(step: Step | null) {
    state = { ...state, draft: step };
    emit();
  },
  updateDraft(patch: Partial<Step>) {
    if (!state.draft) return;
    state = { ...state, draft: { ...state.draft, ...patch } };
    emit();
  },
  clearDraft() {
    state = { ...state, draft: null };
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
