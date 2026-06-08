import { AlertCircle } from "lucide-react";
import { statusName, statusDescription } from "@/lib/grpc-status";
import type { InvokeOutcomeIpc } from "@/ipc/bindings";

/**
 * Postman-style gRPC error face: the canonical status code + name and what it means,
 * the server's message, and request timing. Structured `google.rpc` details require
 * decoding the `grpc-status-details-bin` trailer in the backend (currently dropped) —
 * deferred to a follow-up; we surface an honest note. Trailing metadata lives in the
 * Trailers tab (rendered by ResponsePanel).
 */
export function ErrorView({ outcome }: { outcome: InvokeOutcomeIpc }) {
  const name = statusName(outcome.status_code);
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-none items-center gap-2.5 border-b border-border bg-destructive/5 px-4 py-3 text-destructive">
        <AlertCircle className="size-4 flex-none" />
        <span className="rounded bg-destructive/15 px-1.5 py-0.5 font-mono text-[11px] font-semibold tabular-nums">
          {outcome.status_code}
        </span>
        <span className="font-mono text-sm font-semibold">{name}</span>
        <span className="ml-auto font-mono text-[11px] tabular-nums text-muted-foreground">
          {outcome.elapsed_ms}ms
        </span>
      </div>
      <div className="flex-1 space-y-4 overflow-auto scroll-thin p-4 text-xs">
        <p className="leading-relaxed text-muted-foreground">{statusDescription(outcome.status_code)}</p>

        {outcome.status_message ? (
          <div>
            <p className="mb-1 font-medium text-foreground/70">message</p>
            <p className="break-all font-mono text-foreground/85">{outcome.status_message}</p>
          </div>
        ) : null}

        <div>
          <p className="mb-1 font-medium text-foreground/70">details</p>
          <p className="leading-relaxed text-muted-foreground">
            Структурированные details (google.rpc) пока недоступны — требуется декодирование
            бинарного трейлера <code className="font-mono">grpc-status-details-bin</code> на бэкенде.
            Trailing metadata см. во вкладке Trailers.
          </p>
        </div>
      </div>
    </div>
  );
}
