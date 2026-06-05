import { ResponsePanel } from "@/features/response/ResponsePanel";
import type { RespState } from "@/features/response/RespMeta";
import { authResolve } from "@/ipc/client";
import { ClientErrorBanner } from "./ClientErrorBanner";
import { AddressBar } from "./AddressBar";
import { DraftAddressBar } from "./DraftAddressBar";
import { useDraftReflection } from "./useDraftReflection";
import { RequestTabs } from "./RequestTabs";
import {
  resolveAuthHeader,
  sendStep,
  stepPatchFromSendResult,
  shouldRecordExecuted,
  buildExecutedStep,
  cancelStep,
  applyMethodSelection,
} from "./actions";
import { newId } from "@/lib/ids";
import type { MetadataRow, Step } from "./model";

interface CallPanelProps {
  step: Step;
  /** Apply a patch to the edited step (history step in place, or the global draft). */
  onPatch: (patch: Partial<Step>) => void;
  /** Draft only: record a completed call as an executed history snapshot. */
  onExecuted?: (executed: Step) => void;
  /** Focus(draft) only: editable host + reflection + MethodPicker header. */
  editable?: boolean;
}

/** The editable, sendable surface for one step — reused by Focus(draft)/List/Ledger. */
export function CallPanel({ step, onPatch, onExecuted, editable }: CallPanelProps) {
  const onBody = (value: string) => onPatch({ requestJson: value });
  const onMetadata = (rows: MetadataRow[]) => onPatch({ metadata: rows });

  const onSend = async () => {
    const requestId = newId();
    onPatch({ status: "sending", error: null, requestId });
    const auth = await resolveAuthHeader(step.auth, authResolve);
    if (auth.kind === "error") {
      onPatch({ status: "error", outcome: null, error: auth.message, requestId: null });
      return;
    }
    const res = await sendStep(step, auth.kind === "header" ? auth.header : null, { requestId });
    const patch = { ...stepPatchFromSendResult(res), requestId: null };
    onPatch(patch);
    if (onExecuted && shouldRecordExecuted(res)) onExecuted(buildExecutedStep(step, patch));
  };

  const onCancel = () => {
    if (step.requestId) void cancelStep(step.requestId);
  };

  const reflection = useDraftReflection(step.address, step.tls, !!editable);

  const header = editable ? (
    <DraftAddressBar
      step={step}
      catalog={reflection.catalog}
      reflecting={reflection.loading}
      reflectError={reflection.error}
      onAddress={(address) => onPatch({ address })}
      onTls={(tls) => onPatch({ tls })}
      onRefresh={reflection.refresh}
      onSelectMethod={(m) =>
        void applyMethodSelection(onPatch, { address: step.address, tls: step.tls }, m)
      }
      onSend={onSend}
      onCancel={onCancel}
    />
  ) : (
    <AddressBar step={step} onSend={onSend} onCancel={onCancel} />
  );

  return (
    <div className="flex h-full flex-col">
      {header}
      <div className="flex min-h-0 flex-1">
        <div className="min-w-0 flex-1 border-r border-border">
          <RequestTabs step={step} serviceAuth={step.auth} onBody={onBody} onMetadata={onMetadata} />
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
      {step.error && !step.outcome ? <ClientErrorBanner message={step.error} /> : null}
      <ResponsePanel state={respState} outcome={step.outcome} />
    </>
  );
}
