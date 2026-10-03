import { useCallback } from "react";
import { cancelStep, sendStep, type SendResult } from "./actions";
import { workflowStore, type DraftOrigin } from "./store";
import { useCatalog } from "@/features/catalog/CatalogProvider";
import { newId } from "@/lib/ids";
import type { SendReportIpc } from "@/ipc/bindings";
import type { Step } from "./model";
import { isKindMismatch, type KindMismatchFault } from "./netDiagnostics";

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
  if (res.kind === "cancelled") {
    return { status: "draft", outcome: null, error: null };
  }
  return { status: "error", outcome: null, error: res.fault };
}

/** Executed history snapshot of a call: the step as sent, with the auth/TLS the core
 *  pipeline *actually used* (from the report — fact, not a second `auth_effective`
 *  fetch that could go stale), the outcome patch applied, a fresh id and no in-flight
 *  request. Shared by the unary Send and the streaming path. */
export function executedSnapshot(
  step: Step,
  report: Pick<SendReportIpc, "auth_used" | "tls_used">,
  patch: Partial<Step>,
): Step {
  return {
    ...step,
    auth: report.auth_used,
    tls: report.tls_used,
    ...patch,
    id: newId(),
    requestId: null,
  };
}

/** Credit the saved request an executed draft came from with one execution.
 *  Best-effort: a failing bump never disturbs the call. No origin ⇒ no-op. */
export async function bumpOriginUsage(
  bumpUsage: (collectionId: string, requestId: string, at: number) => Promise<unknown>,
  origin: DraftOrigin | null,
): Promise<void> {
  if (!origin) return;
  await bumpUsage(origin.collectionId, origin.requestId, Date.now()).catch(() => {});
}

/** Options of a call attempt shared by `useSend.send` and `useStreamCall.open`. */
export interface AttemptOptions {
  /** The **retry** of a one-shot re-route (`useCall`): the refused attempt left the step
   *  legitimately `sending`, so the idempotency gate is skipped — the caller owns the gate
   *  for the whole re-route. Invariant: a retry never depends on the closure's `step.status`
   *  being stale; it is allowed through explicitly. */
  retry?: boolean;
}

/** The single home of the unary Send lifecycle: gate → send → patch → executed
 *  snapshot → usage bump. A **kind mismatch** (core refused the unary path for a
 *  streaming method; nothing reached the wire) is the one outcome left un-patched: it is
 *  returned to the caller, the step still `sending`, so `useCall` can re-route once or
 *  show the face. Every other outcome resolves to `null` after its patch. */
export function useSend({ step, envName, onPatch, record = false, origin = null }: UseSendArgs) {
  const { bumpUsage } = useCatalog();

  const send = useCallback(async ({ retry = false }: AttemptOptions = {}): Promise<KindMismatchFault | null> => {
    // Idempotent: Send stays inert while in flight — except the explicit retry of a
    // re-route, whose step is `sending` from the refused attempt (see `AttemptOptions`).
    if (step.status === "sending" && !retry) return null;
    const requestId = newId();
    // `streamId: null` — a unary Send drops any stale stream reference (the release rule frees it).
    onPatch({ status: "sending", error: null, requestId, streamId: null });
    const res = await sendStep(step, { envName }, { requestId });
    if (res.kind === "error" && isKindMismatch(res.fault)) return res.fault;
    const patch = { ...stepPatch(res), requestId: null };
    onPatch(patch);
    if (record && res.kind === "ok") {
      workflowStore.commitExecutedStep(executedSnapshot(step, res.report, patch));
      void bumpOriginUsage(bumpUsage, origin);
    }
    return null;
  }, [step, envName, onPatch, record, origin, bumpUsage]);

  const cancel = useCallback(() => {
    if (step.requestId) void cancelStep(step.requestId);
  }, [step.requestId]);

  return { send, cancel };
}
