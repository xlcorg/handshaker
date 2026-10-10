import type {
  CallFaultIpc,
  CallOutcomeIpc,
  CallRecordIpc,
  InvokeOutcomeIpc,
  RecordedMessageIpc,
  StreamKindIpc,
  StreamTerminationIpc,
} from "@/ipc/bindings";
import type { Step } from "@/features/workflow/model";
import type { DraftOrigin } from "@/features/workflow/store";
import type { ClientFault } from "@/features/workflow/netDiagnostics";
import type { MessageMeta, StreamEntry } from "@/features/stream/streamStore";
import type { MethodKind } from "@/lib/method-kind";

export interface CallStart {
  id: string;
  step: Step;
  startedAt: number;
  origin: DraftOrigin | null;
}

export type CallFinish =
  | { type: "unary"; outcome: InvokeOutcomeIpc }
  | { type: "unary_fault"; fault: ClientFault; elapsedMs: number }
  | { type: "stream"; entry: StreamEntry; elapsedMs: number }
  | { type: "stream_refused"; kind: StreamKindIpc; fault: ClientFault; elapsedMs: number };

const U32_MAX = 0xffff_ffff;

function u32(n: number): number {
  return Number.isFinite(n) ? Math.min(Math.max(Math.round(n), 0), U32_MAX) : 0;
}

/** Pure. The request is copied as authored from `start.step`: templates, tri-state TLS,
 *  every metadata row and `step.auth` (not the auth the pipeline used). Messages and the
 *  unary body pass through whole, because core's `append` owns the size bound. Integers
 *  are clamped to u32 so `into_core` never rejects a record the app built. */
export function buildRecord(start: CallStart, finish: CallFinish): CallRecordIpc {
  const { step, origin } = start;
  return {
    id: start.id,
    started_at_ms: start.startedAt,
    origin: origin ? { collection_id: origin.collectionId, request_id: origin.requestId } : null,
    request: {
      address_template: step.address,
      tls_override: step.tls,
      service: step.service,
      method: step.method,
      body_template: step.requestJson,
      metadata: step.metadata.map((row) => ({ ...row })),
      auth: step.auth,
    },
    elapsed_ms: u32(finish.type === "unary" ? finish.outcome.elapsed_ms : finish.elapsedMs),
    outcome: outcomeOf(finish),
  };
}

export function streamKindOf(kind: MethodKind): StreamKindIpc {
  if (kind === "unary") throw new Error("streamKindOf: unary is not a stream kind");
  return kind;
}

function outcomeOf(finish: CallFinish): CallOutcomeIpc {
  switch (finish.type) {
    case "unary": {
      const o = finish.outcome;
      return {
        type: "unary",
        status: { code: o.status_code, message: o.status_message, trailers: o.trailing_metadata },
        response: o.response_json === null ? { type: "absent" } : { type: "inline", json: o.response_json },
      };
    }
    case "unary_fault":
      return { type: "unary_fault", fault: faultIpc(finish.fault) };
    case "stream": {
      const e = finish.entry;
      return {
        type: "stream",
        kind: streamKindOf(e.kind),
        headers: e.headers,
        messages: e.messages.map(messageIpc),
        omitted_messages: 0,
        end: terminationOf(e),
      };
    }
    case "stream_refused":
      return { type: "stream_refused", kind: finish.kind, fault: faultIpc(finish.fault) };
  }
}

function terminationOf(e: StreamEntry): StreamTerminationIpc {
  if (e.end) {
    const { statusCode, statusMessage, trailingMetadata } = e.end;
    return { type: "status", status: { code: statusCode, message: statusMessage, trailers: trailingMetadata } };
  }
  if (e.fault) return { type: "fault", fault: faultIpc(e.fault) };
  return { type: "cancelled" };
}

function faultIpc(f: ClientFault): CallFaultIpc {
  return { kind: f.kind, message: f.message };
}

function messageIpc(m: MessageMeta): RecordedMessageIpc {
  return {
    direction: m.dir,
    index: u32(m.index),
    at_ms: m.atMs,
    size_bytes: u32(m.sizeBytes),
    preview: m.preview,
    json: m.json,
  };
}
