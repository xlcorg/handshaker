import { useCallback } from "react";
import { cancelStep, sendStep, type SendResult } from "./actions";
import { workflowStore, type DraftOrigin } from "./store";
import { useCatalog } from "@/features/catalog/CatalogProvider";
import { newId } from "@/lib/ids";
import type { Step } from "./model";

interface UseSendArgs {
  step: Step;
  envName: string | null;
  /** Apply a patch to the edited step (history step in place, or the global draft). */
  onPatch: (patch: Partial<Step>) => void;
  /** Focus(draft) only: record a completed call as an executed history snapshot. */
  record?: boolean;
  /** Origin-bound draft only: credit the saved request with one execution. */
  origin?: DraftOrigin | null;
}

/** Step patch for a Send result. Internal — the lifecycle's single home is this hook. */
function stepPatch(res: SendResult): Partial<Step> {
  if (res.kind === "ok") {
    const outcome = res.report.outcome;
    return { status: outcome.status_code === 0 ? "ok" : "error", outcome, error: null };
  }
  if (res.kind === "unresolved") {
    const message = res.cycle
      ? `Variable cycle: ${res.cycle.join(" → ")}`
      : `Unresolved variables: ${res.unresolved.map((v) => `{{${v}}}`).join(", ")}`;
    return { status: "error", outcome: null, error: { kind: "other", message } };
  }
  if (res.kind === "cancelled") {
    return { status: "draft", outcome: null, error: null };
  }
  return { status: "error", outcome: null, error: res.fault };
}

/** The single home of the Send lifecycle: gate → send → patch → executed snapshot →
 *  usage bump. The snapshot freezes the auth/TLS the core pipeline *actually used*
 *  (from the Send report) so re-sending the history step works standalone — no
 *  second `auth_effective` fetch that could go stale. */
export function useSend({ step, envName, onPatch, record = false, origin = null }: UseSendArgs) {
  const { bumpUsage } = useCatalog();

  const send = useCallback(async () => {
    if (step.status === "sending") return; // idempotent: Send stays inert while in flight
    const requestId = newId();
    onPatch({ status: "sending", error: null, requestId });
    const res = await sendStep(step, { envName }, { requestId });
    const patch = { ...stepPatch(res), requestId: null };
    onPatch(patch);
    if (record && res.kind === "ok") {
      const executed: Step = {
        ...step,
        auth: res.report.auth_used,
        tls: res.report.tls_used,
        ...patch,
        id: newId(),
        requestId: null,
      };
      workflowStore.commitExecutedStep(executed);
      if (origin) {
        void bumpUsage(origin.collectionId, origin.requestId, Date.now()).catch(() => {});
      }
    }
  }, [step, envName, onPatch, record, origin, bumpUsage]);

  const cancel = useCallback(() => {
    if (step.requestId) void cancelStep(step.requestId);
  }, [step.requestId]);

  return { send, cancel };
}
