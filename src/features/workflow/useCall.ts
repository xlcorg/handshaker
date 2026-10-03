import { useCallback, useRef } from "react";
import { useSend } from "./useSend";
import { useStreamCall } from "@/features/stream/useStreamCall";
import { isStreaming, type MethodKind } from "@/lib/method-kind";
import type { DraftOrigin } from "./store";
import type { Step } from "./model";
import type { KindMismatchFault } from "./netDiagnostics";

export interface UseCallArgs {
  step: Step;
  envName: string | null;
  /** The **controls kind** the call panel derived (`controlsKind`: live call → catalog →
   *  last executed → null); `null` = unknown — the unary path, never a guessed stream. */
  kind: MethodKind | null;
  /** Apply a patch to the edited step (history step in place, or the global draft). */
  onPatch: (patch: Partial<Step>) => void;
  /** Focus(draft) only: record a finished call as an executed history snapshot. */
  record?: boolean;
  /** Origin-bound draft only: credit the saved request with one execution. */
  origin?: DraftOrigin | null;
}

/** The one place that chooses a call path and can cross it: owns the unary lifecycle
 *  (`useSend`) and the Stream call lifecycle (`useStreamCall`), routes Send by `kind`
 *  (any streaming kind → Open, unary or unknown → unary Send) and performs the **one-shot
 *  re-route**: when core refuses the attempt with a kind mismatch (nothing reached the
 *  wire — a stale or missing catalog), the call is retried exactly once via the path of
 *  the contract's `actual` kind. A second mismatch shows the face instead of looping.
 *  After a successful re-route the step is exactly as if the right path had been chosen.
 *  Cancel follows the call that is live, not the catalog — and a Cancel that lands between
 *  the refusal and the retry wins: the retry is never issued. */
export function useCall({ step, envName, kind, onPatch, record = false, origin = null }: UseCallArgs) {
  const lifecycle = { step, envName, onPatch, record, origin };
  const unary = useSend(lifecycle);
  const stream = useStreamCall(lifecycle);

  // Per-send flags: `inFlight` spans both attempts; `cancelled` is raised by `cancel()`
  // while a send is in flight and consulted before the retry. Refs, not state: the
  // refusal → retry gap is one IPC round trip, no render is needed to observe it.
  const inFlight = useRef(false);
  const cancelled = useRef(false);

  const { open } = stream;
  const { send: sendUnary } = unary;
  const send = useCallback(async () => {
    if (step.status === "sending" || inFlight.current) return; // idempotent: Send stays inert while in flight
    inFlight.current = true;
    cancelled.current = false;
    try {
      // `useCall` owns the idempotency gate for the whole re-route: the first attempt is
      // gated here, the retry is let through explicitly (`retry`) because the refused
      // attempt legitimately left the step `sending`.
      const attempt = (k: MethodKind | null, retry: boolean): Promise<KindMismatchFault | null> =>
        isStreaming(k) ? open(k as MethodKind, { retry }) : sendUnary({ retry });
      const refused = await attempt(kind, false);
      if (!refused) return;
      if (cancelled.current) {
        // The user cancelled while the first attempt was being refused: nothing is on the
        // wire and nothing will be — back to a non-sending state, as a unary cancel lands
        // (status/requestId reset; the refused attempt's stream entry is already dropped).
        onPatch({ status: "draft", outcome: null, error: null, requestId: null, streamId: null });
        return;
      }
      // Safe to retry: the refused attempt put nothing on the wire, and a client/bidi
      // re-route is an Open, which sends nothing.
      const again = await attempt(refused.mismatch.actual, true);
      if (again) onPatch({ status: "error", outcome: null, error: again, requestId: null, streamId: null });
    } finally {
      inFlight.current = false;
    }
  }, [step.status, kind, open, sendUnary, onPatch]);

  const liveCancel = step.streamId !== null && step.requestId !== null ? stream.cancel : unary.cancel;
  const cancel = useCallback(() => {
    if (inFlight.current) cancelled.current = true;
    return liveCancel();
  }, [liveCancel]);

  return { send, cancel, sendMessage: stream.sendMessage, halfClose: stream.halfClose };
}
