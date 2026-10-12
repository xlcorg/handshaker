import type { CallFaultIpc, CallRecordIpc, CallSummaryIpc, CollectionIpc, SummaryLineIpc } from "@/ipc/bindings";
import type { Draft } from "@/features/workflow/model";
import type { DraftOrigin } from "@/features/workflow/store";
import { parseFaultKind, type ClientFault } from "@/features/workflow/netDiagnostics";
import { shortService } from "@/features/workflow/stepView";
import { findSavedRequest } from "@/features/catalog/treeNav";
import { draftFromTemplate, recordedTemplateOf } from "@/features/catalog/mapping";
import type { MethodKind } from "@/lib/method-kind";
import { statusName } from "@/lib/grpc-status";
import { httpStatusText, httpVerdict } from "@/lib/http-status";
import { messages } from "@/lib/messages";

export type Verdict = "ok" | "failed";
export type HistoryChip = "all" | Verdict;

export interface HistoryFilter {
  text: string;
  chip: HistoryChip;
}

export function verdictOf(line: SummaryLineIpc): Verdict {
  if (line.protocol === "http") return line.ending.type === "status" ? httpVerdict(line.ending.code) : "failed";
  return line.ending.type === "status" && line.ending.code === 0 ? "ok" : "failed";
}

export function statusTextOf(line: SummaryLineIpc): string {
  const ending = line.ending;
  switch (ending.type) {
    case "status":
      return line.protocol === "http" ? httpStatusText(ending.code) : statusName(ending.code);
    case "fault":
      return messages.response.clientError.title[parseFaultKind(ending.kind)];
    case "cancelled":
      return messages.history.status.cancelled;
  }
}

export function faultOf(fault: CallFaultIpc): ClientFault {
  return { kind: parseFaultKind(fault.kind), message: fault.message };
}

/** gRPC `Service.Method`, HTTP `GET {{base}}/users`. */
export function rowLabelOf(line: SummaryLineIpc): string {
  return line.protocol === "http" ? `${line.method} ${line.url_template}` : `${shortService(line.service)}.${line.method}`;
}

/** The address template of a gRPC call, the URL template of an HTTP call. */
export function targetOf(line: SummaryLineIpc): string {
  return line.protocol === "http" ? line.url_template : line.address_template;
}

const pad2 = (n: number) => String(n).padStart(2, "0");

export function formatCallTime(startedAtMs: number, nowMs: number = Date.now()): string {
  const d = new Date(startedAtMs);
  const now = new Date(nowMs);
  const time = `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  const sameDay =
    d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
  if (sameDay) return `${time}:${pad2(d.getSeconds())}`;
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${time}`;
}

function searchFieldsOf(line: SummaryLineIpc): string[] {
  const id = line.protocol === "http" ? [line.method] : [line.service, line.method];
  return [...id, targetOf(line), statusTextOf(line)];
}

export function filterRows(rows: readonly CallSummaryIpc[], filter: HistoryFilter): CallSummaryIpc[] {
  const text = filter.text.trim().toLowerCase();
  return rows.filter(({ line }) => {
    if (filter.chip !== "all" && verdictOf(line) !== filter.chip) return false;
    if (!text) return true;
    return searchFieldsOf(line).some((s) => s.toLowerCase().includes(text));
  });
}

/** null for HTTP, which has no method kind. */
export function recordKind(record: CallRecordIpc): MethodKind | null {
  if (record.call.protocol === "http") return null;
  const o = record.call.outcome;
  return o.type === "stream" || o.type === "stream_refused" ? o.kind : "unary";
}

export type OpenPlan =
  | { kind: "bound"; draft: Draft; origin: DraftOrigin }
  | { kind: "unbound"; draft: Draft; originMissing: boolean };

export function planHistoryOpen(record: CallRecordIpc, tree: readonly CollectionIpc[]): OpenPlan {
  const draftIn = (collectionId: string | null) => draftFromTemplate(recordedTemplateOf(record.call), collectionId);
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
