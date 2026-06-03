import { useSyncExternalStore } from "react";
import { newWorkflow, type Workflow } from "./model";

export interface WorkflowState {
  workflows: Workflow[];
  activeWorkflowId: string;
}

function initialState(): WorkflowState {
  const wf = newWorkflow("workflow-1");
  return { workflows: [wf], activeWorkflowId: wf.id };
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
  createWorkflow(name: string): Workflow {
    const wf = newWorkflow(name);
    state = { workflows: [...state.workflows, wf], activeWorkflowId: wf.id };
    emit();
    return wf;
  },
  setActiveWorkflow(id: string) {
    if (state.workflows.some((w) => w.id === id)) {
      state = { ...state, activeWorkflowId: id };
      emit();
    }
  },
};

export function useWorkflowState(): WorkflowState {
  return useSyncExternalStore(workflowStore.subscribe, workflowStore.getState);
}

export function useActiveWorkflow(): Workflow {
  useWorkflowState(); // subscribe
  return workflowStore.activeWorkflow();
}
