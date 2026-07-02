import { ResponsePanel, type ContractInfo } from "@/features/response/ResponsePanel";
import type { RespState } from "@/features/response/RespMeta";
import { AddressBar } from "./AddressBar";
import { DraftAddressBar } from "./DraftAddressBar";
import { useDraftReflection } from "./useDraftReflection";
import { useMessageSchema } from "./useMessageSchema";
import { useEffectiveAuth } from "./useEffectiveAuth";
import { RequestTabs } from "./RequestTabs";
import {
  sendStep,
  stepPatchFromSendResult,
  shouldRecordExecuted,
  buildExecutedStep,
  cancelStep,
  applyMethodSelection,
  resetBodyToTemplate,
  varsResolverFor,
} from "./actions";
import { workflowStore } from "./store";
import { isSendHotkey } from "./sendHotkey";
import { useEnvRevision } from "@/features/envs/envRevision";
import { useActiveEnvVars } from "@/features/envs/useActiveEnvVars";
import { buildVarCandidates } from "@/features/vars/candidates";
import { newId } from "@/lib/ids";
import { useEffect, useMemo, useRef, useState } from "react";
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
  /** Auth of the draft's origin collection. No longer read here — `effectiveAuth` now
   *  asks core via `useEffectiveAuth`/`auth_effective` (keyed on `step.collectionId`),
   *  which looks up the same collection. Kept on the props type for FocusView's call
   *  site. */
  originAuth?: SavedAuthConfigIpc;
  /** Variables of the draft's origin collection — feeds {{var}} autocomplete. */
  originVars?: Partial<Record<string, string>>;
  /** Origin-bound only: a method was just picked. (prev, next) carry the service/method
   *  before and after the switch — lets the owner auto-rename the saved request when its
   *  name still tracks the old method. */
  onMethodSelected?: (
    prev: { service: string; method: string },
    next: { service: string; method: string },
  ) => void;
}

/** The editable, sendable surface for one step — reused by Focus(draft)/List/Ledger. */
export function CallPanel({ step, onPatch, onExecuted, editable, onQuickAddMethod, originAuth: _originAuth, originVars, onMethodSelected }: CallPanelProps) {
  const [prefs, setPref] = usePrefs();
  const activeWf = useActiveWorkflow();
  // Re-resolve the address preview when the active env's identity or contents change
  // (the preview resolves against the active env via the backend — see envRevision).
  const envRevision = useEnvRevision();
  const addressResolveKey = `${step.collectionId ?? ""}|${activeWf.envName ?? ""}|${envRevision}`;
  const activeEnvVars = useActiveEnvVars();
  const varCandidates = useMemo(
    () => (editable ? buildVarCandidates(activeEnvVars, originVars) : undefined),
    [editable, activeEnvVars, originVars],
  );
  // prefs.split is our own convention ("horizontal" = a horizontal divider = Top/Bottom);
  // react-resizable-panels uses the inverse ("horizontal" = side-by-side), so flip it.
  const orientation = prefs.split === "horizontal" ? "vertical" : "horizontal";

  const onBody = (value: string) => onPatch({ requestJson: value });
  const onMetadata = (rows: MetadataRow[]) => onPatch({ metadata: rows });
  const onResetBody = () =>
    void resetBodyToTemplate(onPatch, { address: step.address, tls: step.tls, collectionId: step.collectionId }, step.service, step.method);

  // Effective auth: the step's own config, falling back to the origin collection's
  // (request-level auth has no editor UI, so saved requests carry `none`). Asks core's
  // `pick_auth_config` via `auth_effective` (the single home of the pick rule) rather
  // than re-deriving it in TS — see `useEffectiveAuth`. `addressResolveKey` already
  // folds env name + revision + collection, so an env switch refetches.
  const effectiveAuth = useEffectiveAuth(
    step.auth,
    { collection_id: step.collectionId ?? null, env_name: activeWf.envName },
    addressResolveKey,
  );

  const onSend = async () => {
    if (step.status === "sending") return; // idempotent: the button stays "Send" during the pre-gate window
    const requestId = newId();
    onPatch({ status: "sending", error: null, requestId });
    // The raw draft (templates + step's own auth) goes over the wire as-is — `grpc_send`
    // resolves vars, picks request-vs-collection auth, and materializes/invalidates the
    // oauth2 token via the core pipeline. No frontend auth resolution left to do here.
    const res = await sendStep(
      { ...step, auth: step.auth },
      { envName: activeWf.envName },
      { requestId },
    );
    const patch = { ...stepPatchFromSendResult(res), requestId: null };
    onPatch(patch);
    // Snapshot the auth actually used, so re-sending the history step works standalone.
    if (onExecuted && shouldRecordExecuted(res)) {
      onExecuted(buildExecutedStep({ ...step, auth: effectiveAuth }, patch));
    }
  };

  const onCancel = () => {
    if (step.requestId) void cancelStep(step.requestId);
  };

  // Ctrl/Cmd+Enter and Ctrl/Cmd+R send the active draft (mirrors the Send button).
  // Bound only for the editable Focus draft so history re-send panels don't all
  // fire at once. A ref holds the freshest send logic so the window listener binds
  // once. (Monaco swallows these chords while the request editor has focus, so
  // BodyView re-binds them as editor commands too.)
  const sendShortcutRef = useRef<() => void>(() => {});
  sendShortcutRef.current = () => {
    if (step.status === "sending" || step.method.trim().length === 0) return;
    void onSend();
  };
  useEffect(() => {
    if (!editable) return;
    const onKey = (e: KeyboardEvent) => {
      if (!isSendHotkey(e)) return;
      // preventDefault also suppresses the WebView's built-in Ctrl+R reload.
      e.preventDefault();
      sendShortcutRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [editable]);

  // `addressResolveKey` carries the active env (name + revision + collection): the address is
  // a `{{var}}` template resolved against it, so an env switch/edit must re-reflect even though
  // `step.address` is unchanged. Without it the contract froze on the first env until a manual
  // refresh — the "doesn't pick up on env change" bug.
  const reflection = useDraftReflection(step.address, step.tls, !!editable, step.collectionId, addressResolveKey);

  // Manual "Refresh server reflection": re-reflect the backend pool AND force the schema
  // hooks to refetch. The schema feeds the Contract tab + body hints from a cache that's
  // otherwise keyed only by the (unchanged) target, so without bumping this revision it
  // would freeze on its first result — the "one-time action" bug.
  const [schemaRevision, setSchemaRevision] = useState(0);
  const refreshContract = () => {
    reflection.refresh();
    setSchemaRevision((r) => r + 1);
  };

  // Schema for the draft's method — input side for request autocomplete + ghost,
  // output side for the Contract tab.
  // History panels pass an empty target so no fetch fires.
  const schemaTarget = editable
    ? { address: step.address, tls: step.tls, service: step.service, method: step.method, collectionId: step.collectionId }
    : { address: "", tls: false, service: "", method: "", collectionId: null };
  const schema = useMessageSchema(schemaTarget, "input", schemaRevision, addressResolveKey);
  const outputSchema = useMessageSchema(schemaTarget, "output", schemaRevision, addressResolveKey);

  const header = editable ? (
    <DraftAddressBar
      step={step}
      catalog={reflection.catalog}
      reflecting={reflection.loading}
      reflectError={reflection.error}
      onAddress={(address) => onPatch({ address })}
      onTls={(tls) => onPatch({ tls })}
      onRefresh={refreshContract}
      onReflectCancel={reflection.cancel}
      onSelectMethod={(m) => {
          // Snapshot the pre-switch method BEFORE applyMethodSelection patches the draft,
          // so the owner can decide whether the saved name still tracked it.
          const prev = { service: step.service, method: step.method };
          void applyMethodSelection(
            onPatch,
            { address: step.address, tls: step.tls, collectionId: step.collectionId },
            { requestJson: step.requestJson, service: step.service, method: step.method },
            m,
            workflowStore.activeWorkflow().steps,
          );
          onMethodSelected?.(prev, { service: m.service, method: m.method });
        }}
      onSend={onSend}
      onCancel={onCancel}
      onQuickAdd={onQuickAddMethod}
      resolveAddress={varsResolverFor(step.collectionId)}
      resolveKey={addressResolveKey}
      variables={varCandidates}
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
            varCandidates={varCandidates}
            metadataResolver={editable ? varsResolverFor(step.collectionId) : undefined}
            metadataResolveKey={addressResolveKey}
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
