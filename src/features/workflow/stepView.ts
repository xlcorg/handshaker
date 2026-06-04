import type { Step } from "./model";

export type StepTone = "ok" | "error" | "pending";

export interface StepSummary {
  number: number; // 1-based display position
  service: string; // full proto-service name
  method: string;
  title: string; // "shortService · method"
  tone: StepTone;
  statusText: string; // "draft" | "…" | "✓ 0" | "✕ 5" | "✕ error"
  elapsedMs: number | null;
}

/** Last dotted segment of a proto-service full name (display-friendly). */
export function shortService(service: string): string {
  const parts = service.split(".");
  return parts[parts.length - 1] || service;
}

/** Map a step + its list position to its collapsed-row / rail display model. */
export function summarizeStep(step: Step, index: number): StepSummary {
  const common = {
    number: index + 1,
    service: step.service,
    method: step.method,
    title: `${shortService(step.service)} · ${step.method}`,
  };

  if (step.status === "sending") {
    return { ...common, tone: "pending", statusText: "…", elapsedMs: null };
  }
  if (step.outcome) {
    const ok = step.outcome.status_code === 0;
    return {
      ...common,
      tone: ok ? "ok" : "error",
      statusText: `${ok ? "✓" : "✕"} ${step.outcome.status_code}`,
      elapsedMs: step.outcome.elapsed_ms,
    };
  }
  if (step.error) {
    return { ...common, tone: "error", statusText: "✕ error", elapsedMs: null };
  }
  return { ...common, tone: "pending", statusText: "draft", elapsedMs: null };
}
