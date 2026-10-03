import type { Step } from "./model";
import type { StreamEntry } from "@/features/stream/streamStore";
import { formatElapsed } from "@/features/stream/format";
import type { MethodKind } from "@/lib/method-kind";
import { statusName } from "@/lib/grpc-status";
import { messages } from "@/lib/messages";

const m = messages.workflow.step;

export type StepTone = "ok" | "error" | "pending";

/** Tone → text colour (row dot / status text / header chip). */
export const TONE_TEXT: Record<StepTone, string> = {
  ok: "text-ok",
  error: "text-destructive",
  pending: "text-muted-foreground",
};

/** Tone → background colour (the rail's filled dot). */
export const TONE_BG: Record<StepTone, string> = {
  ok: "bg-ok",
  error: "bg-destructive",
  pending: "bg-muted-foreground",
};

export interface StepSummary {
  number: number; // 1-based display position
  service: string; // full proto-service name
  method: string;
  title: string; // "shortService · method"
  tone: StepTone;
  statusText: string; // "draft" | "…" | "✓ 0" | "✕ 5" | "✕ error" | "cancelled"
  elapsedMs: number | null;
  /** The kind a stream step ran as (its entry's `Opened.kind`) — the row badge. Null for
   *  unary steps and for a stream whose entry was released: no badge. */
  kind: MethodKind | null;
}

/** Last dotted segment of a proto-service full name (display-friendly). */
export function shortService(service: string): string {
  const parts = service.split(".");
  return parts[parts.length - 1] || service;
}

/** Elapsed of a finished stream: the frozen local clock the footer showed, else the
 *  wire's `End.elapsed_ms`. */
function streamElapsed(entry: StreamEntry): number | null {
  return entry.elapsedMs ?? entry.end?.elapsedMs ?? null;
}

export interface TerminalResult {
  /** gRPC status code (0 = OK). */
  code: number;
  elapsedMs: number | null;
}

/** The one place that decides which terminal source a finished (`ok` / `error`) step is
 *  summarized from: a stream step's `entry.end` (the same End the footer shows) wins,
 *  else the unary `outcome`. Null when neither exists — a released stream entry or a
 *  client-side fault — so the caller falls back on `step.status` alone. */
export function terminalResult(step: Step, entry: StreamEntry | null): TerminalResult | null {
  const stream = step.streamId !== null ? entry : null;
  if (stream?.end) return { code: stream.end.statusCode, elapsedMs: streamElapsed(stream) };
  if (step.outcome) return { code: step.outcome.status_code, elapsedMs: step.outcome.elapsed_ms };
  return null;
}

/** Map a step + its list position to its collapsed-row / rail display model. A stream
 *  step (`streamId` set) is summarized from its Stream store `entry` — the same `End` /
 *  Cancel the footer shows — since `Step.outcome` is unary-only; without the entry
 *  (released) the terminal status alone is summarized, never as a draft. */
export function summarizeStep(step: Step, index: number, entry: StreamEntry | null = null): StepSummary {
  const stream = step.streamId !== null ? entry : null;
  const common = {
    number: index + 1,
    service: step.service,
    method: step.method,
    title: `${shortService(step.service)} · ${step.method}`,
    kind: stream?.kind ?? null,
  };

  switch (step.status) {
    case "sending":
      return { ...common, tone: "pending", statusText: m.sending, elapsedMs: null };
    case "cancelled":
      // A cancelled Stream call: terminal, no gRPC status.
      return { ...common, tone: "pending", statusText: m.cancelled, elapsedMs: stream ? streamElapsed(stream) : null };
    case "ok":
    case "error": {
      const result = terminalResult(step, entry);
      if (result) {
        const ok = result.code === 0;
        return {
          ...common,
          tone: ok ? "ok" : "error",
          statusText: ok ? m.ok(result.code) : m.errorCode(result.code),
          elapsedMs: result.elapsedMs,
        };
      }
      if (step.status === "ok") return { ...common, tone: "ok", statusText: m.ok(0), elapsedMs: null };
      return { ...common, tone: "error", statusText: m.error, elapsedMs: null };
    }
    case "draft":
      return { ...common, tone: "pending", statusText: m.draft, elapsedMs: null };
  }
}

export interface StatusChip {
  tone: StepTone;
  text: string;
}

/** The history header's status chip — the footer's vocabulary: `✓ OK · <elapsed>`,
 *  `✕ <code> <NAME>`, `○ Cancelled`, `✕ error` (client fault). A stream step reads its
 *  `entry`'s End / Cancel; unary reads `outcome`. Null while sending (the controls morph
 *  to Cancel) and for a draft. */
export function statusChip(step: Step, entry: StreamEntry | null): StatusChip | null {
  const c = messages.workflow.addressBar.chip;
  switch (step.status) {
    case "sending":
    case "draft":
      return null;
    case "cancelled":
      return { tone: "pending", text: c.cancelled };
    case "ok":
    case "error": {
      const result = terminalResult(step, entry);
      if (!result) {
        return step.status === "ok" ? { tone: "ok", text: c.okNoElapsed } : { tone: "error", text: c.error };
      }
      if (result.code !== 0) return { tone: "error", text: c.status(result.code, statusName(result.code)) };
      return { tone: "ok", text: result.elapsedMs === null ? c.okNoElapsed : c.ok(formatElapsed(result.elapsedMs)) };
    }
  }
}
