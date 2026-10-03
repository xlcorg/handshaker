import { useCallback, useRef } from "react";
import * as ipc from "@/ipc/client";
import type { MethodKindIpc, StreamEventIpc } from "@/ipc/bindings";
import { callOptionsOf, cancelStep, sendCtxOf, sendDraftOf } from "@/features/workflow/actions";
import { bumpOriginUsage, executedSnapshot, type AttemptOptions } from "@/features/workflow/useSend";
import { workflowStore, type DraftOrigin } from "@/features/workflow/store";
import type { Step } from "@/features/workflow/model";
import {
  faultFromIpcError,
  faultFromUnknown,
  isCancelError,
  isKindMismatch,
  type KindMismatchFault,
} from "@/features/workflow/netDiagnostics";
import { useCatalog } from "@/features/catalog/CatalogProvider";
import { newId } from "@/lib/ids";
import { isLivePhase, streamStore } from "./streamStore";

export interface UseStreamCallArgs {
  step: Step;
  envName: string | null;
  /** Apply a patch to the edited step (history step in place, or the global draft). */
  onPatch: (patch: Partial<Step>) => void;
  /** Focus(draft) only: record a finished call as an executed history snapshot. */
  record?: boolean;
  /** Origin-bound draft only: credit the saved request with one execution. */
  origin?: DraftOrigin | null;
}

/** The single home of the Stream call lifecycle on the frontend: gate → register the
 *  entry → `stream_open` (resolves at Opened) → channel events into the `streamStore` →
 *  terminal patch (`End` OK → ok, non-OK → error, Cancel → cancelled) → executed
 *  snapshot → usage bump. Two-way calls (client / bidi) add **Send message**
 *  (`stream_send` of the current body template, ack → `→` row) and **Half-close**
 *  (`stream_half_close`, entry marked half-closed) while the call is live; both leave the
 *  step `sending` — a rejected send is data on the entry (`sendFault`), never a terminal
 *  fault. Shares the wire helpers with `useSend`; unary is untouched. */
export function useStreamCall({ step, envName, onPatch, record = false, origin = null }: UseStreamCallArgs) {
  const { bumpUsage } = useCatalog();
  // Events land long after Open; always patch through the freshest handler.
  const onPatchRef = useRef(onPatch);
  onPatchRef.current = onPatch;

  /** Terminal transition of a call that reached Open: patch the step and, in Focus(draft),
   *  append the executed snapshot (auth/TLS from `Opened` — fact, not a second fetch). */
  const finish = useCallback(
    (opened: Step, id: string, patch: Partial<Step>) => {
      const full: Partial<Step> = { ...patch, requestId: null };
      onPatchRef.current(full);
      if (!record) return;
      const entry = streamStore.get(id);
      const snapPatch = { ...full, streamId: id, outcome: null };
      const snap =
        entry?.authUsed && entry.tlsUsed !== null
          ? executedSnapshot(opened, { auth_used: entry.authUsed, tls_used: entry.tlsUsed }, snapPatch)
          : { ...opened, ...snapPatch, id: newId(), requestId: null };
      workflowStore.commitExecutedStep(snap);
      void bumpOriginUsage(bumpUsage, origin);
    },
    [record, origin, bumpUsage],
  );

  /** **Open** with `kind` — the kind the caller derived (catalog, or the `actual` of a
   *  refused attempt); core compares it with the contract. A **kind mismatch** (pre-Open,
   *  nothing on the wire) is the one rejection left un-patched: the entry is dropped and
   *  the fault returned, the step still `sending`, so `useCall` can re-route once or show
   *  the face. Every other outcome resolves to `null` after its patch. `retry` marks that
   *  re-route's second attempt (the gate is skipped — see `AttemptOptions`). */
  const open = useCallback(async (kind: MethodKindIpc, { retry = false }: AttemptOptions = {}): Promise<KindMismatchFault | null> => {
    // Idempotent: Send stays inert while live — except the explicit retry of a re-route,
    // whose step is `sending` from the refused attempt (see `AttemptOptions`).
    if (step.status === "sending" && !retry) return null;
    const id = newId();
    streamStore.open(id, kind);
    onPatchRef.current({ status: "sending", error: null, outcome: null, requestId: id, streamId: id });
    const onEvent = (ev: StreamEventIpc) => {
      if (ev.type === "End" || ev.type === "Fault") {
        const cur = streamStore.get(id);
        if (!cur || !isLivePhase(cur.phase)) return; // a Cancel already won
      }
      streamStore.push(id, ev);
      if (ev.type === "End") finish(step, id, { status: ev.status_code === 0 ? "ok" : "error", error: null });
      // A post-Open fault (phase-2 deadline, decode, transport) wears the unary
      // client-error face: same mapping as a pre-Open rejection, onto `Step.error`.
      else if (ev.type === "Fault") finish(step, id, { status: "error", error: faultFromIpcError(ev.error) });
    };
    try {
      await ipc.streamOpen(sendDraftOf(step), sendCtxOf(step, envName), id, kind, callOptionsOf(), onEvent);
    } catch (e) {
      if (isCancelError(e)) {
        // Cancelled before Opened: nothing reached the server — no snapshot.
        if (streamStore.cancel(id)) onPatchRef.current({ status: "cancelled", error: null, requestId: null });
        return null;
      }
      // Pre-Open fault: the entry never opened.
      streamStore.drop(id);
      const fault = faultFromUnknown(e);
      if (isKindMismatch(fault)) return fault;
      // The existing client-error face.
      onPatchRef.current({ status: "error", outcome: null, error: fault, requestId: null, streamId: null });
    }
    return null;
  }, [step, envName, finish]);

  /** **Send message** (two-way calls): the current body template + the resolve ctx of
   *  this moment go to `stream_send`; core resolves `{{var}}` / built-ins per message (auth
   *  was materialized once at Open). The ack becomes the `→` row. A rejection
   *  (`UnresolvedVars`, `EncodeRequest` for an invalid body, `StreamClosed`) lands on the
   *  entry as `sendFault` — the stream stays open. No-op without a live call or once
   *  half-closed. */
  const sendMessage = useCallback(async () => {
    const id = step.requestId;
    if (!id || step.streamId !== id) return;
    const entry = streamStore.get(id);
    if (!entry || !isLivePhase(entry.phase) || entry.halfClosed) return;
    try {
      const ack = await ipc.streamSend(id, step.requestJson, sendCtxOf(step, envName));
      streamStore.pushOutbound(id, ack);
    } catch (e) {
      streamStore.setSendFault(id, faultFromUnknown(e));
    }
  }, [step, envName]);

  /** **Half-close** (two-way calls): ends the outbound side; the call stays live until the
   *  server's End (the phase-2 deadline now runs in core). The half-closed state is
   *  frontend-known — set on the entry when `stream_half_close` resolves. */
  const halfClose = useCallback(async () => {
    const id = step.requestId;
    if (!id || step.streamId !== id) return;
    const entry = streamStore.get(id);
    if (!entry || !isLivePhase(entry.phase) || entry.halfClosed) return;
    try {
      await ipc.streamHalfClose(id);
      streamStore.halfClose(id);
    } catch (e) {
      streamStore.setSendFault(id, faultFromUnknown(e));
    }
  }, [step]);

  /** Cancel is not an event: after `grpc_cancel` resolves the frontend freezes the entry
   *  itself. A racing `End` that already landed wins (no double terminal). */
  const cancel = useCallback(async () => {
    const id = step.requestId;
    if (!id) return;
    await cancelStep(id);
    if (streamStore.cancel(id)) finish(step, id, { status: "cancelled", error: null });
  }, [step, finish]);

  return { open, sendMessage, halfClose, cancel };
}
