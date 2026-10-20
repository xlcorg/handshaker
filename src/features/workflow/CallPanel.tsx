import {
  ResponsePanel,
  type ContractInfo,
} from "@/features/response/ResponsePanel";
import type { RespState } from "@/features/response/RespMeta";
import { DraftAddressBar, type TwoWayControls } from "./DraftAddressBar";
import { useContractRead } from "./useContractRead";
import { useEffectiveAuth } from "./useEffectiveAuth";
import { RequestTabs } from "./RequestTabs";
import {
  applyMethodSelection,
  resetBodyToTemplate,
  varsResolverFor,
} from "./actions";
import { useCatalog } from "@/features/catalog/CatalogProvider";
import { cancelCall, halfCloseStream, recordedDispatch, sendStreamMessage } from "./callLifecycle";
import { StreamView } from "@/features/stream/StreamView";
import {
  isLivePhase,
  useStreamEntry,
  type StreamEntry,
} from "@/features/stream/streamStore";
import { workflowStore } from "./store";
import type { DraftOrigin } from "./store";
import { useSendHotkey } from "./useSendHotkey";
import { FocusSplit } from "./FocusSplit";
import { useEnvRevision } from "@/features/envs/envRevision";
import { resolveKey } from "./resolveKey";
import { useActiveEnvVars } from "@/features/envs/useActiveEnvVars";
import { buildVarCandidates } from "@/features/vars/candidates";
import { useMemo } from "react";
import type { MetadataRow, Step } from "./model";
import { isTwoWay, kindOf } from "@/lib/method-kind";
import { controlsKind, executedKind } from "./controlsKind";
import { useActiveWorkflow } from "./store";

interface CallPanelProps {
  step: Step;
  onPatch: (patch: Partial<Step>) => void;
  /** One-click save of a method row from MethodPicker to the collection. */
  onQuickAddMethod?: (service: string, method: string) => void;
  /** Variables of the draft's origin collection — feeds {{var}} autocomplete. */
  originVars?: Partial<Record<string, string>>;
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
  /** Bound draft only. Credits that saved request with one execution. */
  origin?: DraftOrigin | null;
}

export function CallPanel({
  step,
  onPatch,
  onQuickAddMethod,
  originVars,
  originDefaultTls,
  onMethodSelected,
  origin,
}: CallPanelProps) {
  const activeWf = useActiveWorkflow();
  // Re-resolve the address preview when the active env's identity or contents change
  // (the preview resolves against the active env via the backend — see envRevision).
  const envRevision = useEnvRevision();
  const addressResolveKey = resolveKey({
    collectionId: step.collectionId,
    envName: activeWf.envName,
    envRevision,
  });
  const activeEnvVars = useActiveEnvVars();
  const varCandidates = useMemo(
    () => buildVarCandidates(activeEnvVars, originVars),
    [activeEnvVars, originVars],
  );

  const onBody = (value: string) => onPatch({ requestJson: value });
  const onMetadata = (rows: MetadataRow[]) => onPatch({ metadata: rows });
  const onResetBody = () =>
    void resetBodyToTemplate(
      onPatch,
      {
        address: step.address,
        tls: step.tls,
        collectionId: step.collectionId,
        envName: activeWf.envName,
      },
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
  const reflection = useContractRead({
    addressTemplate: step.address,
    tlsOverride: step.tls,
    collectionId: step.collectionId,
    envName: activeWf.envName,
    service: step.service,
    method: step.method,
    resolveKey: addressResolveKey,
    enabled: true,
  });
  const refreshContract = reflection.refresh;

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
  const liveEntry =
    entry !== null && step.requestId === entry.id && isLivePhase(entry.phase)
      ? entry
      : null;

  const kind = controlsKind({
    liveKind: liveEntry?.kind ?? null,
    catalogKind,
    executedKind: executedKind(step, entry),
  });

  const { bumpUsage } = useCatalog();
  const send = () =>
    void recordedDispatch({
      draft: step,
      envName: activeWf.envName,
      kind,
      recording: { origin: origin ?? null, bumpUsage },
    });
  const cancel = () => void cancelCall({ step });

  const twoWay: TwoWayControls | undefined =
    liveEntry !== null && isTwoWay(liveEntry.kind)
      ? {
          canSend: liveEntry.phase === "open" && !liveEntry.halfClosed,
          onSendMessage: () => void sendStreamMessage({ step, envName: activeWf.envName }),
          onHalfClose: () => void halfCloseStream({ step }),
        }
      : undefined;

  // Ctrl/Cmd+Enter and Ctrl/Cmd+R send the active draft (mirrors the primary button):
  // Send / Open when idle or ended; Send message while a two-way stream is open; a
  // no-op while a server stream is live (or after half-close), so a subscription is
  // never cancelled by the chord.
  const submit = useSendHotkey(() => {
    if (step.method.trim().length === 0) return;
    if (step.status === "sending") {
      if (twoWay?.canSend) twoWay.onSendMessage();
      return;
    }
    void send();
  });

  const schema = reflection.inputSchema;
  const outputSchema = reflection.outputSchema;

  const header = (
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
          {
            address: step.address,
            tls: step.tls,
            collectionId: step.collectionId,
            envName: activeWf.envName,
          },
          {
            requestJson: step.requestJson,
            service: step.service,
            method: step.method,
          },
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
  );

  return (
    <div className="flex h-full flex-col">
      {header}
      <FocusSplit
        request={
          <RequestTabs
            step={step}
            serviceAuth={effectiveAuth}
            onBody={onBody}
            onMetadata={onMetadata}
            onSubmit={submit}
            onResetTemplate={onResetBody}
            schema={schema}
            varCandidates={varCandidates}
            metadataResolver={varsResolverFor(step.collectionId)}
            metadataResolveKey={addressResolveKey}
          />
        }
        response={
          <div className="flex h-full min-h-0 flex-col">
            <ResponseSlot
              step={step}
              entry={entry}
              // The Contract tab prints the *contract* — the catalog kind, never the controls kind.
              contract={{
                input: schema,
                output: outputSchema,
                method: step.method,
                kind: catalogKind,
              }}
            />
          </div>
        }
      />
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
  if (step.streamId !== null && entry?.phase !== "faulted")
    return <StreamView entry={entry} contract={contract} />;
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
    <ResponsePanel
      state={respState}
      outcome={step.outcome}
      error={step.error}
      contract={contract}
    />
  );
}
