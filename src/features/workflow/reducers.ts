import type { Step, ViewMode, Workflow } from "./model";

export function addStep(wf: Workflow, step: Step): Workflow {
  return { ...wf, steps: [...wf.steps, step], activeStepId: step.id };
}

export function updateStep(wf: Workflow, id: string, patch: Partial<Step>): Workflow {
  let changed = false;
  const steps = wf.steps.map((s) => {
    if (s.id !== id) return s;
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

export function reorderStep(wf: Workflow, from: number, to: number): Workflow {
  if (from === to || from < 0 || from >= wf.steps.length) return wf;
  const steps = [...wf.steps];
  const [moved] = steps.splice(from, 1);
  steps.splice(to, 0, moved);
  return { ...wf, steps };
}

export function setActiveStep(wf: Workflow, id: string | null): Workflow {
  return { ...wf, activeStepId: id };
}

export function setView(wf: Workflow, view: ViewMode): Workflow {
  return { ...wf, view };
}
