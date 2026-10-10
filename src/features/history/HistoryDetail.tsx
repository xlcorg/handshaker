import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { messages } from "@/lib/messages";
import { cn } from "@/lib/cn";
import { formatElapsed } from "@/features/stream/format";
import { useStreamEntry } from "@/features/stream/streamStore";
import type { Step } from "@/features/workflow/model";
import {
  statusChip,
  summarizeStep,
  TONE_TEXT,
} from "@/features/workflow/stepView";

export function HistoryDetail({
  step,
  onRestore,
  onRerun,
}: {
  step: Step;
  onRestore: () => void;
  onRerun: () => void;
}) {
  const h = messages.history;
  const entry = useStreamEntry(step.streamId);
  const summary = summarizeStep(step, 0, entry);
  const chip = statusChip(step, entry);
  const unary = step.streamId === null;
  const enabled = step.metadata.filter((row) => row.enabled);
  const responseJson = step.outcome?.response_json ?? null;
  const trailers = unary
    ? step.outcome?.trailing_metadata
    : entry?.end?.trailingMetadata;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-2 py-1.5">
        <span
          className={cn(
            "truncate text-xs font-medium",
            TONE_TEXT[chip?.tone ?? summary.tone],
          )}
        >
          {chip?.text ?? summary.statusText}
        </span>
        {summary.elapsedMs !== null && (
          <span className="shrink-0 text-xs text-muted-foreground">
            {h.elapsedLabel} {formatElapsed(summary.elapsedMs)}
          </span>
        )}
        <div className="ml-auto flex shrink-0 gap-1">
          <Button
            type="button"
            size="xs"
            variant="outline"
            aria-label="history-restore"
            onClick={onRestore}
          >
            {h.restore}
          </Button>
          <Button
            type="button"
            size="xs"
            aria-label="history-rerun"
            onClick={onRerun}
          >
            {h.rerun}
          </Button>
        </div>
      </div>
      <div className="min-h-0 flex-1 space-y-3 overflow-auto p-2">
        <Section title={h.request}>
          <pre className="max-h-36 overflow-auto whitespace-pre-wrap break-all rounded-md bg-muted/50 p-2 font-mono text-[11px]">
            {step.requestJson}
          </pre>
        </Section>
        <Section title={h.metadata}>
          {enabled.length === 0 ? (
            <p className="text-xs text-muted-foreground">{h.metadataEmpty}</p>
          ) : (
            <ul className="space-y-0.5 font-mono text-[11px]">
              {enabled.map((row, i) => (
                <li key={`${row.key}:${i}`} className="break-all">
                  {row.key}: {row.value}
                </li>
              ))}
            </ul>
          )}
        </Section>
        <Section title={h.response}>
          {unary ? (
            responseJson ? (
              <pre className="max-h-36 overflow-auto whitespace-pre-wrap break-all rounded-md bg-muted/50 p-2 font-mono text-[11px]">
                {responseJson}
              </pre>
            ) : (
              <p className="text-xs text-muted-foreground">{h.noResponse}</p>
            )
          ) : entry === null ? (
            <p className="text-xs text-muted-foreground">{h.streamReleased}</p>
          ) : entry.messages.length === 0 ? (
            <p className="text-xs text-muted-foreground">{h.noMessages}</p>
          ) : (
            <ul className="space-y-1">
              {entry.messages.map((msg) => (
                <li
                  key={`${msg.dir}-${msg.index}`}
                  className="break-all font-mono text-[11px]"
                >
                  <span className="text-muted-foreground">
                    {msg.dir === "in" ? h.inbound : h.outbound} {msg.index}
                  </span>{" "}
                  {msg.preview}
                </li>
              ))}
            </ul>
          )}
        </Section>
        <Section title={h.trailers}>
          <MetaList rows={metaEntries(trailers)} empty={h.noTrailers} />
        </Section>
        {entry?.headers != null && (
          <Section title={h.headers}>
            <MetaList rows={metaEntries(entry.headers)} empty={h.noHeaders} />
          </Section>
        )}
        {unary && (
          <p className="text-xs text-muted-foreground">{h.headersMissing}</p>
        )}
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-1">
      <h3 className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {title}
      </h3>
      {children}
    </section>
  );
}

function metaEntries(
  map: Partial<Record<string, string>> | null | undefined,
): Array<[string, string]> {
  if (!map) return [];
  const rows: Array<[string, string]> = [];
  for (const [key, value] of Object.entries(map)) {
    if (typeof value === "string") rows.push([key, value]);
  }
  return rows;
}

function MetaList({
  rows,
  empty,
}: {
  rows: Array<[string, string]>;
  empty: string;
}) {
  if (rows.length === 0)
    return <p className="text-xs text-muted-foreground">{empty}</p>;
  return (
    <ul className="space-y-0.5 font-mono text-[11px]">
      {rows.map(([key, value]) => (
        <li key={key} className="break-all">
          {key}: {value}
        </li>
      ))}
    </ul>
  );
}
