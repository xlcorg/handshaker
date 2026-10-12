import type { Draft, Step, Workflow } from "./model";

export function addStep(wf: Workflow, step: Draft): Workflow {
  return { ...wf, steps: [...wf.steps, step], activeStepId: step.id };
}

export function updateStep(wf: Workflow, id: string, patch: Partial<Step>): Workflow {
  let changed = false;
  const steps = wf.steps.map((s) => {
    if (s.id !== id || s.protocol !== "grpc") return s;
    changed = true;
    return { ...s, ...patch };
  });
  return changed ? { ...wf, steps } : wf;
}

export function removeStep(wf: Workflow, id: string): Workflow {
  const idx = wf.steps.findIndex((s) => s.id === id);
  if (idx < 0) return wf;
  const steps = wf.steps.filter((s) => s.id !== id);
  let activeStepId = wf.activeStepId;
  if (wf.activeStepId === id) {
    activeStepId = steps.length === 0 ? null : steps[Math.max(0, idx - 1)].id;
  }
  return { ...wf, steps, activeStepId };
}

export function setWorkflowEnv(wf: Workflow, name: string | null): Workflow {
  return { ...wf, envName: name };
}
