import type { CallEndingIpc, CallFaultIpc, CallRecordIpc, CallSummaryIpc, CollectionIpc } from "@/ipc/bindings";
import { newStep, type Step } from "@/features/workflow/model";
import type { DraftOrigin } from "@/features/workflow/store";
import { parseFaultKind, type ClientFault } from "@/features/workflow/netDiagnostics";
import { shortService } from "@/features/workflow/stepView";
import { findSavedRequest } from "@/features/catalog/treeNav";
import type { MethodKind } from "@/lib/method-kind";
import { statusName } from "@/lib/grpc-status";
import { messages } from "@/lib/messages";

export type Verdict = "ok" | "failed";
export type HistoryChip = "all" | Verdict;

export interface HistoryFilter {
  text: string;
  chip: HistoryChip;
}

/** OK only for a status with code 0. A non-zero status, a fault and a cancel are Failed. */
export function verdictOf(ending: CallEndingIpc): Verdict {
  return ending.type === "status" && ending.code === 0 ? "ok" : "failed";
}

/** The status column text: the status name, the fault title, or Cancelled. */
export function statusTextOf(ending: CallEndingIpc): string {
  switch (ending.type) {
    case "status":
      return statusName(ending.code);
    case "fault":
      return messages.response.clientError.title[parseFaultKind(ending.kind)];
    case "cancelled":
      return messages.history.status.cancelled;
  }
}

/** A recorded fault as the response face renders it. */
export function faultOf(fault: CallFaultIpc): ClientFault {
  return { kind: parseFaultKind(fault.kind), message: fault.message };
}

/** `Echo.Say` for `echo.v1.Echo` / `Say`. */
export function methodLabelOf(call: { service: string; method: string }): string {
  return `${shortService(call.service)}.${call.method}`;
}

const pad2 = (n: number) => String(n).padStart(2, "0");

/** Local `HH:MM:SS` for a call started today, else `YYYY-MM-DD HH:MM`. Records survive a
 *  restart, so a bare time would read yesterday's call as today's. */
export function formatCallTime(startedAtMs: number, nowMs: number = Date.now()): string {
  const d = new Date(startedAtMs);
  const now = new Date(nowMs);
  const time = `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  const sameDay =
    d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
  if (sameDay) return `${time}:${pad2(d.getSeconds())}`;
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${time}`;
}

/** Chip first, then a case-insensitive substring match of `text` against service, method,
 *  address template and status text. Input order is kept, because order belongs to core. */
export function filterRows(rows: readonly CallSummaryIpc[], filter: HistoryFilter): CallSummaryIpc[] {
  const text = filter.text.trim().toLowerCase();
  return rows.filter((row) => {
    if (filter.chip !== "all" && verdictOf(row.ending) !== filter.chip) return false;
    if (!text) return true;
    return [row.service, row.method, row.address_template, statusTextOf(row.ending)].some((s) =>
      s.toLowerCase().includes(text),
    );
  });
}

/** The kind the call ran as. A Re-run takes it, and a stale kind re-routes once. */
export function recordKind(record: CallRecordIpc): MethodKind {
  const o = record.outcome;
  return o.type === "stream" || o.type === "stream_refused" ? o.kind : "unary";
}

export type OpenPlan =
  | { kind: "bound"; draft: Step; origin: DraftOrigin }
  /** `originMissing`: the record had an origin, but its collection or item is gone. */
  | { kind: "unbound"; draft: Step; originMissing: boolean };

/** Where a recorded call opens. The draft is always the record's request with a fresh id
 *  and a clean response. It binds only when the origin still resolves in `tree`; otherwise
 *  it is unbound with `collectionId: null`. A method the server no longer has still opens. */
export function planHistoryOpen(record: CallRecordIpc, tree: readonly CollectionIpc[]): OpenPlan {
  const r = record.request;
  const draftIn = (collectionId: string | null) =>
    newStep({
      address: r.address_template,
      tls: r.tls_override,
      service: r.service,
      method: r.method,
      requestJson: r.body_template,
      metadata: r.metadata.map((row) => ({ ...row })),
      auth: r.auth,
      collectionId,
    });
  const o = record.origin;
  if (!o) return { kind: "unbound", draft: draftIn(null), originMissing: false };
  const saved = findSavedRequest(tree, o.collection_id, o.request_id);
  if (!saved) return { kind: "unbound", draft: draftIn(null), originMissing: true };
  return {
    kind: "bound",
    draft: draftIn(o.collection_id),
    origin: { collectionId: o.collection_id, requestId: o.request_id, requestName: saved.name },
  };
}
