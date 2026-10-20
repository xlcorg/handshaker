import * as ipc from "@/ipc/client";
import type { CallRecordIpc, SendReportIpc, StreamEventIpc } from "@/ipc/bindings";
import { callOptionsOf, cancelStep, sendCtxOf, sendHttp, sendStep, type SendResult } from "./actions";
import { grpcTemplateOf } from "@/features/catalog/mapping";
import type { HttpRun, HttpStep } from "@/features/http/model";
import { workflowStore, type DraftOrigin } from "./store";
import type { Draft, Step } from "./model";
import {
  faultFromIpcError,
  faultFromUnknown,
  isCancelError,
  isKindMismatch,
  type KindMismatchFault,
} from "./netDiagnostics";
import { isLivePhase, streamStore, type StreamEntry } from "@/features/stream/streamStore";
import { buildHttpRecord, buildRecord, streamKindOf } from "@/features/history/record";
import { historyStore } from "@/features/history/store";
import { isStreaming, type MethodKind } from "@/lib/method-kind";
import { newId } from "@/lib/ids";

export type BumpUsage = (collectionId: string, requestId: string, at: number) => Promise<unknown>;

export interface Recording {
  /** The draft's origin at call start. It becomes the record's origin. */
  origin: DraftOrigin | null;
  bumpUsage: BumpUsage;
}

export interface RecordedDispatch {
  draft: Draft;
  envName: string | null;
  kind: MethodKind | null;
  recording: Recording | null;
}

interface Gate {
  cancelled: boolean;
}
const gates = new Map<string, Gate>();

interface LiveCall {
  step: Step;
  recording: Recording | null;
  opened: boolean;
}
const liveCalls = new Map<string, LiveCall>();

type Settle = { by: "event"; patch: Partial<Step> } | { by: "cancel" } | { by: "release" };

export async function recordedDispatch({ draft, envName, kind, recording }: RecordedDispatch): Promise<void> {
  if (draft.protocol === "http") return runHttp(draft, envName, recording);
  return runGrpc(draft, envName, kind, recording);
}

async function runGrpc(
  step: Step,
  envName: string | null,
  kind: MethodKind | null,
  recording: Recording | null,
): Promise<void> {
  const id = step.id;
  if (step.status === "sending" || gates.has(id)) return;
  const gate: Gate = { cancelled: false };
  gates.set(id, gate);
  try {
    const attempt = (k: MethodKind | null) =>
      isStreaming(k) ? openStream(step, envName, k as MethodKind, recording) : runUnary(step, envName, recording);
    const refused = await attempt(kind);
    if (!refused) return;
    if (gate.cancelled) {
      patchStep(id, { status: "draft", outcome: null, error: null, requestId: null, streamId: null });
      return;
    }
    const again = await attempt(refused.mismatch.actual);
    if (again) patchStep(id, { status: "error", outcome: null, error: again, requestId: null, streamId: null });
  } finally {
    gates.delete(id);
  }
}

async function runHttp(draft: HttpStep, envName: string | null, recording: Recording | null): Promise<void> {
  if (draft.run.status === "sending" || gates.has(draft.id)) return;
  gates.set(draft.id, { cancelled: false });
  try {
    const startedAt = Date.now();
    const requestId = newId();
    patchRun(draft.id, { status: "sending", requestId });
    const res = await sendHttp(draft, envName, requestId);
    if (res.kind === "cancelled") {
      patchRun(draft.id, { status: "draft" });
      return;
    }
    const run: HttpRun =
      res.kind === "ok"
        ? { status: "done", response: res.report.response, authUsed: res.report.auth_used }
        : { status: "error", error: res.fault };
    patchRun(draft.id, run);
    if (recording) {
      finishRecorded(
        recording,
        res.kind === "ok" ? { ...draft, id: newId(), run } : null,
        buildHttpRecord(
          { id: requestId, draft, startedAt, origin: recording.origin },
          res.kind === "ok"
            ? { type: "response", response: res.report.response }
            : { type: "fault", fault: res.fault, elapsedMs: Date.now() - startedAt },
        ),
      );
    }
  } finally {
    gates.delete(draft.id);
  }
}

export async function cancelHttpCall(draft: HttpStep): Promise<void> {
  if (draft.run.status === "sending") await cancelStep(draft.run.requestId);
}

export async function cancelCall({ step }: { step: Step }): Promise<void> {
  const gate = gates.get(step.id);
  if (gate) gate.cancelled = true;
  const id = step.requestId;
  if (!id) return;
  await cancelStep(id);
  if (step.streamId === id && streamStore.cancel(id)) settleStream(id, { by: "cancel" });
}

export async function sendStreamMessage({ step, envName }: { step: Step; envName: string | null }): Promise<void> {
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

export async function halfCloseStream({ step }: { step: Step }): Promise<void> {
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

export function abandonStream(id: string): void {
  if (!liveCalls.has(id)) return;
  if (streamStore.cancel(id)) settleStream(id, { by: "release" });
  else liveCalls.delete(id);
}

async function runUnary(
  step: Step,
  envName: string | null,
  recording: Recording | null,
): Promise<KindMismatchFault | null> {
  const startedAt = Date.now();
  const requestId = newId();
  patchStep(step.id, { status: "sending", error: null, requestId, streamId: null });
  const res = await sendStep(step, { envName }, { requestId });
  if (res.kind === "error" && isKindMismatch(res.fault)) return res.fault;
  const patch = { ...stepPatch(res), requestId: null };
  patchStep(step.id, patch);
  if (!recording || res.kind === "cancelled") return null;
  finishRecorded(
    recording,
    res.kind === "ok" ? executedSnapshot(step, res.report, patch) : null,
    buildRecord(
      { id: requestId, step, startedAt, origin: recording.origin },
      res.kind === "ok"
        ? { type: "unary", outcome: res.report.outcome }
        : { type: "unary_fault", fault: res.fault, elapsedMs: Date.now() - startedAt },
    ),
  );
  return null;
}

async function openStream(
  step: Step,
  envName: string | null,
  kind: MethodKind,
  recording: Recording | null,
): Promise<KindMismatchFault | null> {
  const startedAt = Date.now();
  const id = newId();
  streamStore.open(id, kind, startedAt);
  liveCalls.set(id, { step, recording, opened: false });
  patchStep(step.id, { status: "sending", error: null, outcome: null, requestId: id, streamId: id });
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
    await ipc.streamOpen(grpcTemplateOf(step), sendCtxOf(step, envName), id, kind, callOptionsOf(), onEvent);
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
    patchStep(step.id, { status: "error", outcome: null, error: fault, requestId: null, streamId: null });
    if (recording) {
      finishRecorded(
        recording,
        null,
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

function settleStream(id: string, how: Settle): void {
  const live = liveCalls.get(id);
  if (!live) return;
  liveCalls.delete(id);
  const { step, recording, opened } = live;
  if (how.by === "release") {
    if (!opened || !recording) return;
    const entry = streamStore.get(id);
    if (!entry) return;
    finishRecorded(
      recording,
      null,
      buildRecord(
        { id, step, startedAt: entry.openedAt, origin: recording.origin },
        { type: "stream", entry, elapsedMs: entry.elapsedMs ?? Date.now() - entry.openedAt },
      ),
    );
    return;
  }
  const patch = { ...settlePatch(how), requestId: null };
  patchStep(step.id, patch);
  if (!opened || !recording) return;
  const entry = streamStore.get(id);
  finishRecorded(
    recording,
    streamSnapshot(step, entry, id, patch),
    entry
      ? buildRecord(
          { id, step, startedAt: entry.openedAt, origin: recording.origin },
          { type: "stream", entry, elapsedMs: entry.elapsedMs ?? Date.now() - entry.openedAt },
        )
      : null,
  );
}

function finishRecorded(recording: Recording, snapshot: Draft | null, record: CallRecordIpc | null): void {
  if (snapshot) {
    workflowStore.commitExecutedStep(snapshot);
    void bumpOriginUsage(recording);
  }
  if (record) void historyStore.record(record);
}

function patchStep(id: string, patch: Partial<Step>): void {
  workflowStore.updateGrpcDraft(id, patch);
}

function patchRun(id: string, run: HttpRun): void {
  workflowStore.setHttpRun(id, run);
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

function executedSnapshot(step: Step, used: Pick<SendReportIpc, "auth_used" | "tls_used">, patch: Partial<Step>): Step {
  return { ...step, auth: used.auth_used, tls: used.tls_used, ...patch, id: newId(), requestId: null };
}

function streamSnapshot(step: Step, entry: StreamEntry | null, id: string, patch: Partial<Step>): Step {
  const snapPatch = { ...patch, streamId: id, outcome: null };
  return entry?.authUsed && entry.tlsUsed !== null
    ? executedSnapshot(step, { auth_used: entry.authUsed, tls_used: entry.tlsUsed }, snapPatch)
    : { ...step, ...snapPatch, id: newId(), requestId: null };
}

async function bumpOriginUsage({ origin, bumpUsage }: Recording): Promise<void> {
  if (!origin) return;
  await bumpUsage(origin.collectionId, origin.requestId, Date.now()).catch(() => {});
}
