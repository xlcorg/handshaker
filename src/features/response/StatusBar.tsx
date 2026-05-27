import { statusName, formatBytes } from "@/lib/grpc-status";
import type { InvokeOutcomeIpc } from "@/ipc/bindings";

export interface StatusBarProps {
  outcome: InvokeOutcomeIpc;
}

/**
 * Compact status pill — `● CODE · ms · size`. Placed inline at the right end
 * of the response tab strip (Postman-style). Status message lives separately,
 * rendered by `ResponsePanel` as an inline strip below the tabs when non-OK.
 */
export function StatusBar({ outcome }: StatusBarProps) {
  const isOk = outcome.status_code === 0;
  const dotColor = isOk
    ? "bg-[oklch(0.7_0.16_145)]"
    : "bg-[oklch(0.704_0.191_22.216)]";
  return (
    <div className="flex items-center gap-2 text-xs font-mono">
      <span
        className={`inline-block w-2 h-2 rounded-full ${dotColor}`}
        aria-hidden
      />
      <span>{statusName(outcome.status_code)}</span>
      <span className="text-muted-foreground">·</span>
      <span>{outcome.elapsed_ms}ms</span>
      <span className="text-muted-foreground">·</span>
      <span>{formatBytes(outcome.response_json)}</span>
    </div>
  );
}
