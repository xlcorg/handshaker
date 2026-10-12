import type { ReactNode } from "react";
import { RotateCw } from "lucide-react";
import type {
  CallOutcomeIpc,
  CallRecordIpc,
  CallStatusIpc,
  CallSummaryIpc,
  GrpcTemplateIpc,
  HttpBodyIpc,
  HttpOutcomeIpc,
  HttpTemplateIpc,
  MetadataRowIpc,
  RecordedMessageIpc,
} from "@/ipc/bindings";
import { bodyNoteOf } from "@/features/http/model";
import { ClientErrorView } from "@/features/response/ClientErrorView";
import { KVTable, kvRows } from "@/features/response/KVTable";
import { formatClock, formatElapsed } from "@/features/stream/format";
import { cn } from "@/lib/cn";
import { formatByteCount } from "@/lib/grpc-status";
import { messages } from "@/lib/messages";
import { faultOf, formatCallTime, rowLabelOf, statusTextOf, targetOf, verdictOf } from "./model";
import { useCallRecord } from "./store";

const m = messages.history.detail;

export interface HistoryDetailProps {
  row: CallSummaryIpc;
  onRerun: () => void;
}

export function HistoryDetail({ row, onRerun }: HistoryDetailProps) {
  const view = useCallRecord(row.id);
  const label = rowLabelOf(row.line);
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
        {targetOf(row.line)} · {formatCallTime(row.started_at_ms)}
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
  const ok = verdictOf(row.line) === "ok";
  return (
    <span className="flex flex-none items-center gap-1.5">
      <span className={cn("h-1.5 w-1.5 rounded-full", ok ? "bg-ok" : "bg-destructive")} aria-hidden />
      <span className="text-foreground">{statusTextOf(row.line)}</span>
    </span>
  );
}

function RecordSections({ record }: { record: CallRecordIpc }) {
  const call = record.call;
  return call.protocol === "http" ? (
    <HttpSections request={call.request} outcome={call.outcome} />
  ) : (
    <GrpcSections request={call.request} outcome={call.outcome} />
  );
}

function HttpSections({ request, outcome }: { request: HttpTemplateIpc; outcome: HttpOutcomeIpc }) {
  const h = messages.http.history;
  return (
    <>
      <Section title={h.params}>
        <EnabledRows rows={request.query} empty={h.noParams} />
      </Section>
      <Section title={h.headers}>
        <EnabledRows rows={request.headers} empty={h.noHeaders} />
      </Section>
      <Section title={h.body}>
        <HttpRequestBody body={request.body} />
      </Section>
      <Section title={m.response}>
        {outcome.type === "fault" ? (
          <ClientErrorView fault={faultOf(outcome.fault)} />
        ) : outcome.response.body.type === "json" || outcome.response.body.type === "text" ? (
          <Pre>{outcome.response.body.text}</Pre>
        ) : (
          <Muted>{bodyNoteOf(outcome.response.body)}</Muted>
        )}
      </Section>
      <Section title={m.headers}>
        {outcome.type === "response" ? (
          <KVTable rows={outcome.response.headers.map((hd) => ({ k: hd.name, v: hd.value }))} />
        ) : (
          <Muted>{m.notRecorded}</Muted>
        )}
      </Section>
    </>
  );
}

function HttpRequestBody({ body }: { body: HttpBodyIpc }) {
  switch (body.kind) {
    case "none":
      return <Muted>{messages.http.body.none}</Muted>;
    case "json":
    case "text":
      return <Pre>{body.text}</Pre>;
    case "form":
      return <EnabledRows rows={body.fields} empty={messages.http.body.none} />;
  }
}

function EnabledRows({ rows, empty }: { rows: MetadataRowIpc[]; empty: string }) {
  const enabled = rows.filter((row) => row.enabled);
  return enabled.length > 0 ? (
    <KVTable rows={enabled.map((row) => ({ k: row.key, v: row.value }))} />
  ) : (
    <Muted>{empty}</Muted>
  );
}

function GrpcSections({ request, outcome: o }: { request: GrpcTemplateIpc; outcome: CallOutcomeIpc }) {
  return (
    <>
      <Section title={m.request}>
        <Pre>{request.body_template}</Pre>
      </Section>
      <Section title={m.metadata}>
        <EnabledRows rows={request.metadata} empty={m.noMetadata} />
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
