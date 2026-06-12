import { ResponsePanel, type ContractInfo } from "@/features/response/ResponsePanel";
import type { RespState } from "@/features/response/RespMeta";
import { authResolve, varsResolve, authInvalidate } from "@/ipc/client";
import { AddressBar } from "./AddressBar";
import { DraftAddressBar } from "./DraftAddressBar";
import { useDraftReflection } from "./useDraftReflection";
import { useMessageSchema } from "./useMessageSchema";
import { RequestTabs } from "./RequestTabs";
import {
  pickEffectiveAuth,
  resolveAuthHeader,
  sendStep,
  stepPatchFromSendResult,
  shouldRecordExecuted,
  buildExecutedStep,
  cancelStep,
  applyMethodSelection,
  resetBodyToTemplate,
} from "./actions";
import { workflowStore } from "./store";
import { newId } from "@/lib/ids";
import { useEffect, useRef } from "react";
import type { SavedAuthConfigIpc } from "@/ipc/bindings";
import type { MetadataRow, Step } from "./model";
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from "@/components/ui/resizable";
import { usePrefs } from "@/lib/use-prefs";
import { useActiveWorkflow } from "./store";

interface CallPanelProps {
  step: Step;
  /** Apply a patch to the edited step (history step in place, or the global draft). */
  onPatch: (patch: Partial<Step>) => void;
  /** Draft only: record a completed call as an executed history snapshot. */
  onExecuted?: (executed: Step) => void;
  /** Focus(draft) only: editable host + reflection + MethodPicker header. */
  editable?: boolean;
  /** One-click save of a method row from MethodPicker to the collection. */
  onQuickAddMethod?: (service: string, method: string) => void;
  /** Auth of the draft's origin collection — inherited when the step's own auth is none. */
  originAuth?: SavedAuthConfigIpc;
}

/** The editable, sendable surface for one step — reused by Focus(draft)/List/Ledger. */
export function CallPanel({ step, onPatch, onExecuted, editable, onQuickAddMethod, originAuth }: CallPanelProps) {
  const [prefs, setPref] = usePrefs();
  const activeWf = useActiveWorkflow();
  // prefs.split is our own convention ("horizontal" = a horizontal divider = Top/Bottom);
  // react-resizable-panels uses the inverse ("horizontal" = side-by-side), so flip it.
  const orientation = prefs.split === "horizontal" ? "vertical" : "horizontal";

  const onBody = (value: string) => onPatch({ requestJson: value });
  const onMetadata = (rows: MetadataRow[]) => onPatch({ metadata: rows });
  const onResetBody = () =>
    void resetBodyToTemplate(onPatch, { address: step.address, tls: step.tls }, step.service, step.method);

  // Effective auth: the step's own config, falling back to the origin collection's
  // (request-level auth has no editor UI, so saved requests carry `none`).
  const effectiveAuth = pickEffectiveAuth(step.auth, originAuth ?? null, activeWf.envName);

  const onSend = async () => {
    const requestId = newId();
    onPatch({ status: "sending", error: null, requestId });
    const auth = await resolveAuthHeader(effectiveAuth, activeWf.envName, { authResolve, varsResolve });
    if (auth.kind === "error") {
      onPatch({ status: "error", outcome: null, error: auth.message, requestId: null });
      return;
    }
    const res = await sendStep(step, auth.kind === "header" ? auth.header : null, { requestId });
    const patch = { ...stepPatchFromSendResult(res), requestId: null };
    onPatch(patch);
    // Drop the cached oauth2 token if the server rejected it (gRPC UNAUTHENTICATED = 16):
    // the next Send fetches a fresh one. No auto-retry (design choice).
    if (
      res.kind === "ok" &&
      res.outcome.status_code === 16 &&
      auth.kind === "header" &&
      auth.invalidate
    ) {
      void authInvalidate(auth.invalidate).catch(() => {}); // best-effort, like cancelStep
    }
    // Snapshot the auth actually used, so re-sending the history step works standalone.
    if (onExecuted && shouldRecordExecuted(res)) {
      onExecuted(buildExecutedStep({ ...step, auth: effectiveAuth }, patch));
    }
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

  // Schema for the draft's method — input side for request autocomplete + ghost,
  // output side for the Contract tab.
  // History panels pass an empty target so no fetch fires.
  const schemaTarget = editable
    ? { address: step.address, tls: step.tls, service: step.service, method: step.method }
    : { address: "", tls: false, service: "", method: "" };
  const schema = useMessageSchema(schemaTarget, "input");
  const outputSchema = useMessageSchema(schemaTarget, "output");

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
        void applyMethodSelection(
          onPatch,
          { address: step.address, tls: step.tls },
          { requestJson: step.requestJson, service: step.service, method: step.method },
          m,
          workflowStore.activeWorkflow().steps,
        )
      }
      onSend={onSend}
      onCancel={onCancel}
      onQuickAdd={onQuickAddMethod}
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
            serviceAuth={effectiveAuth}
            onBody={onBody}
            onMetadata={onMetadata}
            onSubmit={() => sendShortcutRef.current()}
            onResetTemplate={editable ? onResetBody : undefined}
            schema={schema}
          />
        </ResizablePanel>
        <ResizableHandle withHandle />
        <ResizablePanel id="response" minSize="20%">
          <div className="flex h-full min-h-0 flex-col">
            <ResponseSlot
              step={step}
              contract={editable ? { input: schema, output: outputSchema, method: step.method } : null}
            />
          </div>
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  );
}

function ResponseSlot({
  step,
  contract,
}: {
  step: Step;
  contract: ContractInfo | null;
}) {
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
    <ResponsePanel state={respState} outcome={step.outcome} error={step.error} contract={contract} />
  );
}
