import * as ipc from "@/ipc/client";
import type { SendReportIpc, StreamEventIpc } from "@/ipc/bindings";
import { callOptionsOf, cancelStep, sendCtxOf, sendDraftOf, sendStep, type SendResult } from "./actions";
import { workflowStore, type DraftOrigin } from "./store";
import type { Step } from "./model";
import {
  faultFromIpcError,
  faultFromUnknown,
  isCancelError,
  isKindMismatch,
  type KindMismatchFault,
} from "./netDiagnostics";
import { isLivePhase, streamStore, type StreamEntry } from "@/features/stream/streamStore";
import { buildRecord, streamKindOf } from "@/features/history/record";
import { historyStore } from "@/features/history/store";
import { isStreaming, type MethodKind } from "@/lib/method-kind";
import { newId } from "@/lib/ids";

export type BumpUsage = (collectionId: string, requestId: string, at: number) => Promise<unknown>;

/** What a Focus draft call leaves behind. `null` on `CallArgs` means an in-place List/Ledger
 *  send: no executed snapshot, no call record and no usage bump. */
export interface Recording {
  /** The draft's origin at call start. It becomes the record's origin. */
  origin: DraftOrigin | null;
  bumpUsage: BumpUsage;
}

export interface CallArgs {
  /** The step as it is sent. The executed snapshot and the call record freeze this value,
   *  not a later one. */
  step: Step;
  envName: string | null;
  /** The controls kind (CallPanel) or a recorded kind. `null` takes the unary path. */
  kind: MethodKind | null;
  /** Patch the step this call belongs to, addressed by its id, so a call never patches a
   *  step that replaced its own. */
  onPatch: (patch: Partial<Step>) => void;
  recording: Recording | null;
}

interface Gate {
  cancelled: boolean;
}
/** Keyed by step id. Present while a `runCall` is in flight, across the re-route. */
const gates = new Map<string, Gate>();

interface LiveCall {
  args: CallArgs;
  /** `Opened` arrived: separates a Cancel after Open from one before it. */
  opened: boolean;
}
/** Keyed by stream id. Set before `stream_open` is awaited, deleted by `settleStream`. */
const liveCalls = new Map<string, LiveCall>();

type Settle =
  | { by: "event"; patch: Partial<Step> }
  | { by: "cancel" }
  | { by: "release" };

/** Send or Open by `kind`, re-routing once on a kind mismatch (core refused the path and
 *  nothing reached the wire). Inert while this step id has a call in flight or the step is
 *  `sending`. A Cancel during the refusal-to-retry gap wins: the retry is never issued. */
export async function runCall(args: CallArgs): Promise<void> {
  const id = args.step.id;
  if (args.step.status === "sending" || gates.has(id)) return;
  const gate: Gate = { cancelled: false };
  gates.set(id, gate);
  try {
    const attempt = (k: MethodKind | null) => (isStreaming(k) ? openStream(args, k as MethodKind) : runUnary(args));
    const refused = await attempt(args.kind);
    if (!refused) return;
    if (gate.cancelled) {
      args.onPatch({ status: "draft", outcome: null, error: null, requestId: null, streamId: null });
      return;
    }
    const again = await attempt(refused.mismatch.actual);
    if (again) args.onPatch({ status: "error", outcome: null, error: again, requestId: null, streamId: null });
  } finally {
    gates.delete(id);
  }
}

/** Cancel whatever is live on `step`: a stream (the entry freezes and settles as cancelled)
 *  or a unary request (its result arrives as `cancelled`). It also raises the re-route
 *  gate's cancelled flag. */
export async function cancelCall({ step }: Pick<CallArgs, "step">): Promise<void> {
  const gate = gates.get(step.id);
  if (gate) gate.cancelled = true;
  const id = step.requestId;
  if (!id) return;
  await cancelStep(id);
  if (step.streamId === id && streamStore.cancel(id)) settleStream(id, { by: "cancel" });
}

/** **Send message** (two-way calls): the current body template and the resolve ctx of this
 *  moment go to `stream_send`; core resolves per message. The ack becomes the `→` row. A
 *  rejection lands on the entry as `sendFault` and the stream stays open. No-op without a
 *  live call or once half-closed. */
export async function sendStreamMessage({ step, envName }: Pick<CallArgs, "step" | "envName">): Promise<void> {
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
}

/** **Half-close** (two-way calls): ends the outbound side; the call stays live until the
 *  server's End. The half-closed state is set on the entry when `stream_half_close` resolves. */
export async function halfCloseStream({ step }: Pick<CallArgs, "step">): Promise<void> {
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
}

/** Called by the release rule before it frees `id`. A live call is frozen and settled
 *  without a patch, because the step it belonged to is gone. After Open it is recorded as
 *  cancelled. Any other id is a no-op. */
export function abandonStream(id: string): void {
  if (!liveCalls.has(id)) return;
  if (streamStore.cancel(id)) settleStream(id, { by: "release" });
  else liveCalls.delete(id);
}

async function runUnary({ step, envName, onPatch, recording }: CallArgs): Promise<KindMismatchFault | null> {
  const startedAt = Date.now();
  const requestId = newId();
  onPatch({ status: "sending", error: null, requestId, streamId: null });
  const res = await sendStep(step, { envName }, { requestId });
  if (res.kind === "error" && isKindMismatch(res.fault)) return res.fault;
  const patch = { ...stepPatch(res), requestId: null };
  onPatch(patch);
  if (!recording || res.kind === "cancelled") return null;
  if (res.kind === "ok") {
    workflowStore.commitExecutedStep(executedSnapshot(step, res.report, patch));
    void bumpOriginUsage(recording);
  }
  void historyStore.record(
    buildRecord(
      { id: requestId, step, startedAt, origin: recording.origin },
      res.kind === "ok"
        ? { type: "unary", outcome: res.report.outcome }
        : { type: "unary_fault", fault: res.fault, elapsedMs: Date.now() - startedAt },
    ),
  );
  return null;
}

async function openStream(args: CallArgs, kind: MethodKind): Promise<KindMismatchFault | null> {
  const { step, envName, onPatch, recording } = args;
  const startedAt = Date.now();
  const id = newId();
  streamStore.open(id, kind, startedAt);
  liveCalls.set(id, { args, opened: false });
  onPatch({ status: "sending", error: null, outcome: null, requestId: id, streamId: id });
  const onEvent = (ev: StreamEventIpc) => {
    if (ev.type === "Opened") markOpened(id);
    if (ev.type === "End" || ev.type === "Fault") {
      const cur = streamStore.get(id);
      if (!cur || !isLivePhase(cur.phase)) return;
    }
    streamStore.push(id, ev);
    if (ev.type === "End") {
      settleStream(id, { by: "event", patch: { status: ev.status_code === 0 ? "ok" : "error", error: null } });
    } else if (ev.type === "Fault") {
      settleStream(id, { by: "event", patch: { status: "error", error: faultFromIpcError(ev.error) } });
    }
  };
  try {
    await ipc.streamOpen(sendDraftOf(step), sendCtxOf(step, envName), id, kind, callOptionsOf(), onEvent);
    markOpened(id);
  } catch (e) {
    if (!liveCalls.has(id)) return null;
    if (isCancelError(e)) {
      if (streamStore.cancel(id)) settleStream(id, { by: "cancel" });
      return null;
    }
    liveCalls.delete(id);
    streamStore.drop(id);
    const fault = faultFromUnknown(e);
    if (isKindMismatch(fault)) return fault;
    onPatch({ status: "error", outcome: null, error: fault, requestId: null, streamId: null });
    if (recording) {
      void historyStore.record(
        buildRecord(
          { id, step, startedAt, origin: recording.origin },
          { type: "stream_refused", kind: streamKindOf(kind), fault, elapsedMs: Date.now() - startedAt },
        ),
      );
    }
  }
  return null;
}

function markOpened(id: string): void {
  const live = liveCalls.get(id);
  if (live) live.opened = true;
}

/** The terminal transition of a stream call: End, Fault, Cancel and release all land here,
 *  and the first one wins. */
function settleStream(id: string, how: Settle): void {
  const live = liveCalls.get(id);
  if (!live) return;
  liveCalls.delete(id);
  const { args, opened } = live;
  const patch = how.by === "release" ? null : { ...settlePatch(how), requestId: null };
  if (patch) args.onPatch(patch);
  if (!opened || !args.recording) return;
  const entry = streamStore.get(id);
  if (patch) {
    workflowStore.commitExecutedStep(streamSnapshot(args.step, entry, id, patch));
    void bumpOriginUsage(args.recording);
  }
  if (!entry) return;
  void historyStore.record(
    buildRecord(
      { id, step: args.step, startedAt: entry.openedAt, origin: args.recording.origin },
      { type: "stream", entry, elapsedMs: entry.elapsedMs ?? Date.now() - entry.openedAt },
    ),
  );
}

function settlePatch(how: Exclude<Settle, { by: "release" }>): Partial<Step> {
  return how.by === "event" ? how.patch : { status: "cancelled", error: null };
}

function stepPatch(res: SendResult): Partial<Step> {
  if (res.kind === "ok") {
    const outcome = res.report.outcome;
    return { status: outcome.status_code === 0 ? "ok" : "error", outcome, error: null };
  }
  if (res.kind === "cancelled") return { status: "draft", outcome: null, error: null };
  return { status: "error", outcome: null, error: res.fault };
}

/** The step as sent, with the auth/TLS the core pipeline actually used, the outcome patch
 *  applied, a fresh id and no in-flight request. */
function executedSnapshot(
  step: Step,
  used: Pick<SendReportIpc, "auth_used" | "tls_used">,
  patch: Partial<Step>,
): Step {
  return { ...step, auth: used.auth_used, tls: used.tls_used, ...patch, id: newId(), requestId: null };
}

function streamSnapshot(step: Step, entry: StreamEntry | null, id: string, patch: Partial<Step>): Step {
  const snapPatch = { ...patch, streamId: id, outcome: null };
  return entry?.authUsed && entry.tlsUsed !== null
    ? executedSnapshot(step, { auth_used: entry.authUsed, tls_used: entry.tlsUsed }, snapPatch)
    : { ...step, ...snapPatch, id: newId(), requestId: null };
}

/** Best-effort: a failing bump never disturbs the call. No origin means no bump. */
async function bumpOriginUsage({ origin, bumpUsage }: Recording): Promise<void> {
  if (!origin) return;
  await bumpUsage(origin.collectionId, origin.requestId, Date.now()).catch(() => {});
}
