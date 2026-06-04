import { AlertCircle } from "lucide-react";
import { statusName } from "@/lib/grpc-status";
import type { InvokeOutcomeIpc } from "@/ipc/bindings";

/**
 * Postman-style gRPC error face: status code + message prominent. Structured
 * `google.rpc` details require decoding the `grpc-status-details-bin` trailer in the
 * backend (currently dropped) — deferred to a follow-up; we surface an honest note.
 * Trailing metadata lives in the Trailers tab (rendered by ResponsePanel).
 */
export function ErrorView({ outcome }: { outcome: InvokeOutcomeIpc }) {
  const code = statusName(outcome.status_code);
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-none items-center gap-2.5 border-b border-border bg-destructive/5 px-4 py-3 text-destructive">
        <AlertCircle className="size-4" />
        <span className="font-mono text-sm font-semibold">{code}</span>
        <span className="text-muted-foreground">·</span>
        <span className="break-all text-xs text-foreground/85">{outcome.status_message}</span>
      </div>
      <div className="flex-1 overflow-auto scroll-thin p-4 text-xs text-muted-foreground">
        <p className="mb-1 font-medium text-foreground/70">details</p>
        <p>
          Структурированные details (google.rpc) пока недоступны — требуется декодирование
          бинарного трейлера <code className="font-mono">grpc-status-details-bin</code> на бэкенде.
          Trailing metadata см. во вкладке Trailers.
        </p>
      </div>
    </div>
  );
}
