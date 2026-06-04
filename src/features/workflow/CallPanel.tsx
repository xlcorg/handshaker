import { BodyEditor } from "@/features/invoke/BodyEditor";
import { ResponsePanel } from "@/features/response/ResponsePanel";
import type { RespState } from "@/features/response/RespMeta";
import { AddressBar } from "./AddressBar";
import { workflowStore } from "./store";
import { updateStep } from "./reducers";
import { sendStep, stepPatchFromSendResult } from "./actions";
import type { Step } from "./model";

/** The editable, sendable surface for one step — reused by Focus/List/Ledger. */
export function CallPanel({ step }: { step: Step }) {
  const onBody = (value: string) =>
    workflowStore.update((w) => updateStep(w, step.id, { requestJson: value }));

  const onSend = async () => {
    workflowStore.update((w) =>
      updateStep(w, step.id, { status: "sending", error: null }),
    );
    const res = await sendStep(step);
    workflowStore.update((w) => updateStep(w, step.id, stepPatchFromSendResult(res)));
  };

  return (
    <div className="flex h-full flex-col">
      <AddressBar step={step} onSend={onSend} />
      <div className="flex min-h-0 flex-1">
        <div className="min-w-0 flex-1 border-r border-border">
          <BodyEditor value={step.requestJson} onChange={onBody} />
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
