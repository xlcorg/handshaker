import { ResponsePanel, type ContractInfo } from "@/features/response/ResponsePanel";
import type { RespState } from "@/features/response/RespMeta";
import { AddressBar } from "./AddressBar";
import { DraftAddressBar, type TwoWayControls } from "./DraftAddressBar";
import { useDraftReflection } from "./useDraftReflection";
import { useMessageSchema } from "./useMessageSchema";
import { useEffectiveAuth } from "./useEffectiveAuth";
import { RequestTabs } from "./RequestTabs";
import {
  applyMethodSelection,
  resetBodyToTemplate,
  varsResolverFor,
} from "./actions";
import { useCall } from "./useCall";
import { takeRerun } from "@/features/history/actions";
import { StreamView } from "@/features/stream/StreamView";
import { isLivePhase, useStreamEntry, type StreamEntry } from "@/features/stream/streamStore";
import { effectiveTls } from "./tls";
import { workflowStore } from "./store";
import type { DraftOrigin } from "./store";
import { isSendHotkey } from "./sendHotkey";
import { useEnvRevision } from "@/features/envs/envRevision";
import { useActiveEnvVars } from "@/features/envs/useActiveEnvVars";
import { buildVarCandidates } from "@/features/vars/candidates";
import { useEffect, useMemo, useRef, useState } from "react";
import type { MetadataRow, Step } from "./model";
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from "@/components/ui/resizable";
import { usePrefs } from "@/lib/use-prefs";
import { isTwoWay, kindOf } from "@/lib/method-kind";
import { controlsKind, executedKind } from "./controlsKind";
import { useActiveWorkflow } from "./store";

interface CallPanelProps {
  step: Step;
  /** Apply a patch to the edited step (history step in place, or the global draft). */
  onPatch: (patch: Partial<Step>) => void;
  /** Focus(draft) only: editable host + reflection + MethodPicker header. */
  editable?: boolean;
  /** One-click save of a method row from MethodPicker to the collection. */
  onQuickAddMethod?: (service: string, method: string) => void;
  /** Variables of the draft's origin collection — feeds {{var}} autocomplete. */
  originVars?: Partial<Record<string, string>>;
  /** `skip_tls_verify` of the draft's origin collection — dials reflection/skeleton/schema
   *  the same as Send. Unbound draft (no origin) ⇒ false. */
  originSkipVerify?: boolean;
  /** `default_tls` of the draft's origin collection — what a null (inherit) TLS override
   *  resolves to at Send/probe time. Unbound draft (no origin) ⇒ false. */
  originDefaultTls?: boolean;
  /** Origin-bound only: a method was just picked. (prev, next) carry the service/method
   *  before and after the switch — lets the owner auto-rename the saved request when its
   *  name still tracks the old method. */
  onMethodSelected?: (
    prev: { service: string; method: string },
    next: { service: string; method: string },
  ) => void;
  /** Focus(draft) only: origin of the bound draft — lets useSend credit the saved
   *  request with one execution. Absent/null for unbound drafts and history panels. */
  origin?: DraftOrigin | null;
}

/** The editable, sendable surface for one step — reused by Focus(draft)/List/Ledger. */
export function CallPanel({ step, onPatch, editable, onQuickAddMethod, originVars, originSkipVerify, originDefaultTls, onMethodSelected, origin }: CallPanelProps) {
  const skipVerify = originSkipVerify ?? false;
  // Concrete TLS for probes/Send display: the step's override, or the collection default
  // when inheriting (null). Send itself forwards the raw override; core inherits identically.
  const effTls = effectiveTls(step.tls, originDefaultTls ?? false);
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
    void resetBodyToTemplate(
      onPatch,
      { address: step.address, tls: effTls, collectionId: step.collectionId, skipVerify },
      step.service,
      step.method,
    );

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

  // `addressResolveKey` carries the active env (name + revision + collection): the address is
  // a `{{var}}` template resolved against it, so an env switch/edit must re-reflect even though
  // `step.address` is unchanged. Without it the contract froze on the first env until a manual
  // refresh — the "doesn't pick up on env change" bug.
  const reflection = useDraftReflection(
    step.address,
    effTls,
    !!editable,
    step.collectionId,
    addressResolveKey,
    skipVerify,
  );

  // Manual "Refresh server reflection": re-reflect the backend pool AND force the schema
  // hooks to refetch. The schema feeds the Contract tab + body hints from a cache that's
  // otherwise keyed only by the (unchanged) target, so without bumping this revision it
  // would freeze on its first result — the "one-time action" bug.
  const [schemaRevision, setSchemaRevision] = useState(0);
  const refreshContract = () => {
    reflection.refresh();
    setSchemaRevision((r) => r + 1);
  };

  // Catalog kind — derived exactly once, live, from the reflected catalog (never stored
  // on the step). `null` while the catalog is pending/failed or lacks the method. This
  // is the *contract's* kind: it feeds the Contract tab and is the second rung of the
  // controls-kind precedence below.
  const catalogKind = useMemo(
    () => kindOf(reflection.catalog, step.service, step.method),
    [reflection.catalog, step.service, step.method],
  );

  // The step's Stream store entry (one subscription for the controls and the pane).
  const entry = useStreamEntry(step.streamId);
  const liveEntry = entry !== null && step.requestId === entry.id && isLivePhase(entry.phase) ? entry : null;

  // Controls kind — live call → catalog → last executed → null (`controlsKind`, the one
  // place the rule lives). Feeds the address-bar badge + controls and the path `useCall`
  // drives, so a reflection refresh cannot flip the controls mid-call and a history
  // snapshot (panels never reflect ⇒ `catalogKind` null) re-opens with the kind it ran as.
  // `null` ⇒ no badge, unary controls; the UI never *claims* unary.
  const kind = controlsKind({
    liveKind: liveEntry?.kind ?? null,
    catalogKind,
    executedKind: executedKind(step, entry),
  });

  // The call lifecycle lives in `useCall`, which owns both paths — useSend (unary) and
  // useStreamCall (Stream call): gate → send/open → patch → executed snapshot (auth/TLS
  // from the report / `Opened` — fact, not a second fetch) → usage bump. `kind` picks the
  // path Send drives: any streaming kind opens a stream (`server` = Send, `client` /
  // `bidi` = Open), unary or `null` (unknown) takes the unary path — and a kind mismatch
  // from core re-routes once through the other path. Cancel follows the live call.
  const call = useCall({ step, envName: activeWf.envName, kind, onPatch, record: !!editable, origin });
  const { send, cancel } = call;

  useEffect(() => {
    if (!editable) return;
    if (!takeRerun(step.id)) return;
    void send();
  }, [editable, step.id, send]);

  // A live two-way entry — decided by the call's own kind, not the catalog — turns the
  // busy slot into the segmented Send message / Half-close / Cancel controls.
  const twoWay: TwoWayControls | undefined =
    liveEntry !== null && isTwoWay(liveEntry.kind)
      ? {
          canSend: liveEntry.phase === "open" && !liveEntry.halfClosed,
          onSendMessage: () => void call.sendMessage(),
          onHalfClose: () => void call.halfClose(),
        }
      : undefined;

  // Ctrl/Cmd+Enter and Ctrl/Cmd+R send the active draft (mirrors the primary button):
  // Send / Open when idle or ended; Send message while a two-way stream is open; a
  // no-op while a server stream is live (or after half-close), so a subscription is
  // never cancelled by the chord. Bound only for the editable Focus draft so history
  // re-send panels don't all fire at once. A ref holds the freshest send logic so the
  // window listener binds once. (Monaco swallows these chords while the request editor
  // has focus, so BodyView re-binds them as editor commands too.)
  const sendShortcutRef = useRef<() => void>(() => {});
  sendShortcutRef.current = () => {
    if (step.method.trim().length === 0) return;
    if (step.status === "sending") {
      if (twoWay?.canSend) twoWay.onSendMessage();
      return;
    }
    void send();
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

  // Schema for the draft's method — input side for request autocomplete + ghost,
  // output side for the Contract tab.
  // History panels pass an empty target so no fetch fires.
  const schemaTarget = editable
    ? { address: step.address, tls: effTls, service: step.service, method: step.method, collectionId: step.collectionId, skipVerify }
    : { address: "", tls: false, service: "", method: "", collectionId: null };
  const schema = useMessageSchema(schemaTarget, "input", schemaRevision, addressResolveKey);
  const outputSchema = useMessageSchema(schemaTarget, "output", schemaRevision, addressResolveKey);

  const header = editable ? (
    <DraftAddressBar
      step={step}
      catalog={reflection.catalog}
      kind={kind}
      reflecting={reflection.loading}
      reflectError={reflection.error}
      onAddress={(address) => onPatch({ address })}
      onTls={(tls) => onPatch({ tls })}
      defaultTls={originDefaultTls ?? false}
      onRefresh={refreshContract}
      onReflectCancel={reflection.cancel}
      onSelectMethod={(m) => {
          // Snapshot the pre-switch method BEFORE applyMethodSelection patches the draft,
          // so the owner can decide whether the saved name still tracked it.
          const prev = { service: step.service, method: step.method };
          void applyMethodSelection(
            onPatch,
            { address: step.address, tls: effTls, collectionId: step.collectionId, skipVerify },
            { requestJson: step.requestJson, service: step.service, method: step.method },
            m,
            workflowStore.activeWorkflow().steps,
          );
          onMethodSelected?.(prev, { service: m.service, method: m.method });
        }}
      onSend={send}
      onCancel={cancel}
      twoWay={twoWay}
      onQuickAdd={onQuickAddMethod}
      resolveAddress={varsResolverFor(step.collectionId)}
      resolveKey={addressResolveKey}
      variables={varCandidates}
    />
  ) : (
    <AddressBar step={step} kind={kind} onSend={send} onCancel={cancel} twoWay={twoWay} />
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
              entry={entry}
              // The Contract tab prints the *contract* — the catalog kind, never the controls kind.
              contract={editable ? { input: schema, output: outputSchema, method: step.method, kind: catalogKind } : null}
            />
          </div>
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  );
}

function ResponseSlot({
  step,
  entry,
  contract,
}: {
  step: Step;
  /** The step's Stream store entry (the panel's one subscription); null when released. */
  entry: StreamEntry | null;
  contract: ContractInfo | null;
}) {
  // A step that opened a Stream call renders the stream pane off its store entry;
  // `outcome` stays unary-only. A call that faulted after Open never reached stream
  // start (no rows to show), so it wears the unary client-error face off `Step.error` —
  // the spec's "client fault before stream start keeps the existing face". A rejected
  // Send message is NOT such a fault: it stays on the live entry (`sendFault`) and the
  // stream pane shows it as a strip.
  if (step.streamId !== null && entry?.phase !== "faulted") return <StreamView entry={entry} contract={contract} />;
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
