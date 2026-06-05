import type { SavedRequestIpc } from "@/ipc/bindings";
import { newStep, type Step } from "@/features/workflow/model";

/**
 * Build a `SavedRequestIpc` from an editor/executed `Step`.
 * Auth is emitted as `none` until `Step` carries inline auth (later-plan follow-up).
 */
export function stepToSavedRequest(step: Step, opts: { id: string; name: string }): SavedRequestIpc {
  return {
    id: opts.id,
    name: opts.name,
    address_template: step.address,
    service: step.service,
    method: step.method,
    body_template: step.requestJson,
    metadata: step.metadata.map((r) => ({ key: r.key, value: r.value, enabled: r.enabled })),
    auth: { kind: "none" },
    tls_override: step.tls,
    last_used_at: null,
    use_count: 0,
  };
}

/**
 * Populate a fresh draft `Step` (status "draft") from a saved request.
 * Drops the saved `auth` (the draft cannot hold inline auth until a later plan).
 */
export function savedRequestToDraft(saved: SavedRequestIpc): Step {
  return newStep({
    address: saved.address_template,
    tls: saved.tls_override ?? false,
    service: saved.service,
    method: saved.method,
    requestJson: saved.body_template,
    metadata: saved.metadata.map((r) => ({ key: r.key, value: r.value, enabled: r.enabled })),
  });
}
