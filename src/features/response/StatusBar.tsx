import { statusName, formatBytes } from "@/lib/grpc-status";
import type { InvokeOutcomeIpc } from "@/ipc/bindings";

export interface StatusBarProps {
  outcome: InvokeOutcomeIpc;
}

export function StatusBar({ outcome }: StatusBarProps) {
  const ok = outcome.status_code === 0;
  const dotColor = ok ? "bg-[oklch(0.7_0.16_145)]" : "bg-destructive";
  const codeText = statusName(outcome.status_code);
  const size = formatBytes(outcome.response_json);
  return (
    <div className="flex items-center gap-3 px-4 py-2 border-b border-border text-sm font-mono">
      <span className={`inline-block w-2 h-2 rounded-full ${dotColor}`} />
      <span className="font-semibold">{codeText}</span>
      <span className="text-muted-foreground">·</span>
      <span className="text-muted-foreground">{outcome.elapsed_ms}ms</span>
      <span className="text-muted-foreground">·</span>
      <span className="text-muted-foreground">{size}</span>
      {!ok && (
        <span className="ml-2 text-destructive text-xs truncate">
          {outcome.status_message}
        </span>
      )}
    </div>
  );
}
