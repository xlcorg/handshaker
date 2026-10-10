import type { ReactNode } from "react";
import { RotateCw } from "lucide-react";
import type { CallOutcomeIpc, CallRecordIpc, CallStatusIpc, CallSummaryIpc, RecordedMessageIpc } from "@/ipc/bindings";
import { ClientErrorView } from "@/features/response/ClientErrorView";
import { KVTable, kvRows } from "@/features/response/KVTable";
import { formatClock, formatElapsed } from "@/features/stream/format";
import { cn } from "@/lib/cn";
import { formatByteCount } from "@/lib/grpc-status";
import { messages } from "@/lib/messages";
import { faultOf, formatCallTime, methodLabelOf, statusTextOf, verdictOf } from "./model";
import { useCallRecord } from "./store";

const m = messages.history.detail;

export interface HistoryDetailProps {
  row: CallSummaryIpc;
  onRerun: () => void;
}

export function HistoryDetail({ row, onRerun }: HistoryDetailProps) {
  const view = useCallRecord(row.id);
  const label = methodLabelOf(row);
  return (
    <aside
      data-testid="history-detail"
      aria-label={label}
      className="flex min-w-0 basis-[44%] flex-none flex-col overflow-auto border-l border-border scroll-thin"
    >
      <header className="flex flex-none items-center gap-2 border-b border-border/60 px-3 py-1.5 font-mono text-[11px]">
        <span className="truncate font-medium text-foreground">{label}</span>
        <VerdictText row={row} />
        <span className="tabular-nums text-muted-foreground">{formatElapsed(row.elapsed_ms)}</span>
        <button
          type="button"
          data-testid="history-detail-rerun"
          onClick={onRerun}
          className="ml-auto flex h-6 flex-none items-center gap-1 rounded-md border border-border px-2 text-[11px] hover:bg-accent/40"
        >
          <RotateCw className="size-3" aria-hidden />
          {m.rerun}
        </button>
      </header>
      <div className="flex-none truncate px-3 py-1 font-mono text-[11px] text-muted-foreground">
        {row.address_template} · {formatCallTime(row.started_at_ms)}
      </div>
      {view?.phase === "ready" ? (
        <RecordSections record={view.record} />
      ) : (
        <Muted>{view?.phase === "missing" ? m.unavailable : m.loading}</Muted>
      )}
    </aside>
  );
}

function VerdictText({ row }: { row: CallSummaryIpc }) {
  const ok = verdictOf(row.ending) === "ok";
  return (
    <span className="flex flex-none items-center gap-1.5">
      <span className={cn("h-1.5 w-1.5 rounded-full", ok ? "bg-ok" : "bg-destructive")} aria-hidden />
      <span className="text-foreground">{statusTextOf(row.ending)}</span>
    </span>
  );
}

function RecordSections({ record }: { record: CallRecordIpc }) {
  const o = record.outcome;
  const metadata = record.request.metadata.filter((row) => row.enabled);
  return (
    <>
      <Section title={m.request}>
        <Pre>{record.request.body_template}</Pre>
      </Section>
      <Section title={m.metadata}>
        {metadata.length > 0 ? (
          <KVTable rows={metadata.map((row) => ({ k: row.key, v: row.value }))} />
        ) : (
          <Muted>{m.noMetadata}</Muted>
        )}
      </Section>
      <Section title={o.type === "stream" ? m.messages : m.response}>
        <Response outcome={o} />
      </Section>
      <Section title={m.headers}>
        <Headers outcome={o} />
      </Section>
      <Section title={m.trailers}>
        <Trailers outcome={o} />
      </Section>
    </>
  );
}

function Response({ outcome: o }: { outcome: CallOutcomeIpc }) {
  switch (o.type) {
    case "unary":
      return (
        <>
          <StatusMessage status={o.status} />
          {o.response.type === "inline" ? (
            <Pre>{o.response.json}</Pre>
          ) : (
            <Muted>
              {o.response.type === "omitted" ? m.bodyOmitted(formatByteCount(o.response.size_bytes)) : m.noBody}
            </Muted>
          )}
        </>
      );
    case "unary_fault":
    case "stream_refused":
      return <ClientErrorView fault={faultOf(o.fault)} />;
    case "stream":
      return (
        <>
          {o.omitted_messages > 0 && <Muted>{m.messagesOmitted(o.omitted_messages)}</Muted>}
          {o.messages.length > 0 ? (
            <ol>
              {o.messages.map((msg) => (
                <MessageRow key={`${msg.direction}-${msg.index}`} msg={msg} />
              ))}
            </ol>
          ) : (
            o.omitted_messages === 0 && <Muted>{m.noneReceived}</Muted>
          )}
          {o.end.type === "status" && <StatusMessage status={o.end.status} />}
          {o.end.type === "fault" && <ClientErrorView fault={faultOf(o.end.fault)} />}
        </>
      );
  }
}

function MessageRow({ msg }: { msg: RecordedMessageIpc }) {
  const inbound = msg.direction === "in";
  return (
    <li data-testid="history-message" className="border-b border-border/60">
      <details>
        <summary className="flex cursor-pointer items-center gap-2.5 px-3 py-1.5 font-mono text-[11px] hover:bg-accent/30">
          <span
            aria-label={inbound ? messages.stream.row.received : messages.stream.row.sent}
            className={cn("inline-block w-3 flex-none text-center", inbound ? "text-stream" : "text-muted-foreground")}
          >
            {inbound ? "←" : "→"}
          </span>
          <span className="w-8 flex-none tabular-nums text-muted-foreground">{messages.stream.row.index(msg.index)}</span>
          <span className="min-w-0 flex-1 truncate text-foreground/85">{msg.preview}</span>
          <span className="flex-none tabular-nums text-muted-foreground">{formatByteCount(msg.size_bytes)}</span>
          <span className="flex-none tabular-nums text-muted-foreground/70">{formatClock(msg.at_ms)}</span>
        </summary>
        {msg.json !== null ? <Pre>{msg.json}</Pre> : <Muted>{m.messageBodyOmitted}</Muted>}
      </details>
    </li>
  );
}

function Headers({ outcome: o }: { outcome: CallOutcomeIpc }) {
  if (o.type !== "stream") return <Muted>{m.notRecorded}</Muted>;
  if (o.headers === null) return <Muted>{m.noneReceived}</Muted>;
  return <KVTable rows={kvRows(o.headers)} />;
}

function Trailers({ outcome: o }: { outcome: CallOutcomeIpc }) {
  const status = o.type === "unary" ? o.status : o.type === "stream" && o.end.type === "status" ? o.end.status : null;
  return status ? <KVTable rows={kvRows(status.trailers)} /> : <Muted>{m.notRecorded}</Muted>;
}

function StatusMessage({ status }: { status: CallStatusIpc }) {
  if (!status.message) return null;
  return <p className="break-all px-3 py-1.5 font-mono text-[11px] text-foreground/85">{status.message}</p>;
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section aria-label={title} className="flex-none border-b border-border/60">
      <h3 className="px-3 pt-2 pb-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{title}</h3>
      {children}
    </section>
  );
}

function Pre({ children }: { children: string }) {
  return (
    <pre className="overflow-x-auto px-3 py-1.5 font-mono text-[11px] whitespace-pre-wrap break-all text-foreground scroll-thin">
      {children}
    </pre>
  );
}

function Muted({ children }: { children: ReactNode }) {
  return <p className="px-3 py-1.5 text-xs text-muted-foreground italic">{children}</p>;
}
