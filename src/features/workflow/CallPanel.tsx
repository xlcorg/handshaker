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
import { useEffect, useRef } from "react";
import type { MetadataRow, Step } from "./model";
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from "@/components/ui/resizable";
import { usePrefs } from "@/lib/use-prefs";

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
  const [prefs, setPref] = usePrefs();
  // prefs.split is our own convention ("horizontal" = a horizontal divider = Top/Bottom);
  // react-resizable-panels uses the inverse ("horizontal" = side-by-side), so flip it.
  const orientation = prefs.split === "horizontal" ? "vertical" : "horizontal";

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

  // Ctrl/Cmd+Enter sends the active draft (mirrors the Send button). Bound only
  // for the editable Focus draft so history re-send panels don't all fire at once.
  // A ref holds the freshest send logic so the window listener binds once.
  const sendShortcutRef = useRef<() => void>(() => {});
  sendShortcutRef.current = () => {
    if (step.status === "sending" || step.method.trim().length === 0) return;
    void onSend();
  };
  useEffect(() => {
    if (!editable) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        sendShortcutRef.current();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [editable]);

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
      <ResizablePanelGroup
        key={orientation}
        orientation={orientation}
        className="min-h-0 flex-1"
        defaultLayout={{ request: prefs.bodyPanel, response: 100 - prefs.bodyPanel }}
        onLayoutChanged={(layout: Record<string, number>) => {
          const pct = layout["request"];
          if (typeof pct === "number" && pct > 0) setPref("bodyPanel", pct);
        }}
      >
        <ResizablePanel id="request" minSize="20%">
          <RequestTabs
            step={step}
            serviceAuth={step.auth}
            onBody={onBody}
            onMetadata={onMetadata}
            onSubmit={() => sendShortcutRef.current()}
          />
        </ResizablePanel>
        <ResizableHandle withHandle />
        <ResizablePanel id="response" minSize="20%">
          <div className="flex h-full min-h-0 flex-col">
            <ResponseSlot step={step} />
          </div>
        </ResizablePanel>
      </ResizablePanelGroup>
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
