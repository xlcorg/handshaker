import { ResponsePanel } from "@/features/response/ResponsePanel";
import type { RespState } from "@/features/response/RespMeta";
import type { SavedAuthConfigIpc } from "@/ipc/bindings";
import { authResolve } from "@/ipc/client";
import { catalogStore } from "@/features/catalog/store";
import { AddressBar } from "./AddressBar";
import { RequestTabs } from "./RequestTabs";
import { workflowStore } from "./store";
import { updateStep } from "./reducers";
import { resolveStepAuthHeader, sendStep, stepPatchFromSendResult } from "./actions";
import type { MetadataRow, Step } from "./model";

/** The editable, sendable surface for one step — reused by Focus/List/Ledger. */
export function CallPanel({ step }: { step: Step }) {
  const onBody = (value: string) =>
    workflowStore.update((w) => updateStep(w, step.id, { requestJson: value }));
  const onMetadata = (rows: MetadataRow[]) =>
    workflowStore.update((w) => updateStep(w, step.id, { metadata: rows }));

  const onSend = async () => {
    workflowStore.update((w) => updateStep(w, step.id, { status: "sending", error: null }));
    const auth = await resolveStepAuthHeader(
      step.serviceId,
      (id) => catalogStore.getService(id),
      authResolve,
    );
    if (auth.kind === "error") {
      workflowStore.update((w) =>
        updateStep(w, step.id, { status: "error", outcome: null, error: auth.message }),
      );
      return;
    }
    const res = await sendStep(step, auth.kind === "header" ? auth.header : null);
    workflowStore.update((w) => updateStep(w, step.id, stepPatchFromSendResult(res)));
  };

  const svcForAuth = step.serviceId ? catalogStore.getService(step.serviceId) : undefined;
  const serviceAuth: SavedAuthConfigIpc = svcForAuth?.auth ?? { kind: "none" };

  return (
    <div className="flex h-full flex-col">
      <AddressBar step={step} onSend={onSend} />
      <div className="flex min-h-0 flex-1">
        <div className="min-w-0 flex-1 border-r border-border">
          <RequestTabs step={step} serviceAuth={serviceAuth} onBody={onBody} onMetadata={onMetadata} />
        </div>
        <div className="flex min-w-0 flex-1 flex-col">
          <ResponseSlot step={step} />
        </div>
      </div>
    </div>
  );
}

function ResponseSlot({ step }: { step: Step }) {
  const respState: RespState =
    step.status === "sending"
      ? "sending"
      : step.error
        ? "error"
        : step.outcome
          ? step.outcome.status_code === 0
            ? "success"
            : "error"
          : "idle";

  return (
    <>
      {step.error && !step.outcome ? (
        <div className="m-3 flex-none rounded-md border border-destructive bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {step.error}
        </div>
      ) : null}
      <ResponsePanel state={respState} outcome={step.outcome} />
    </>
  );
}
