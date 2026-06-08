import { cn } from "@/lib/cn";
import { statusName, formatBytes } from "@/lib/grpc-status";
import type { InvokeOutcomeIpc } from "@/ipc/bindings";

export type RespState = "idle" | "sending" | "success" | "error";

export interface RespMetaProps {
  state: RespState;
  outcome: InvokeOutcomeIpc | null;
}

export function RespMeta({ state, outcome }: RespMetaProps) {
  if (state === "idle") return <span className="text-xs text-muted-foreground">No response yet</span>;
  if (state === "sending") return null;
  if (!outcome) return null;
  const base = "flex items-center gap-2 font-mono text-[11.5px]";
  const sizeLabel = formatBytes(outcome.response_json);
  if (state === "error") {
    return (
      <span className={cn(base)}>
        <span className="flex items-center gap-1.5">
          <span className="h-1.5 w-1.5 rounded-full bg-destructive" />
          <span className="text-foreground font-medium">{statusName(outcome.status_code)}</span>
        </span>
        <span className="text-muted-foreground">·</span>
        <span className="text-foreground tabular-nums">{outcome.elapsed_ms}ms</span>
        <span className="text-muted-foreground">·</span>
        <span className="text-foreground tabular-nums">{sizeLabel}</span>
      </span>
    );
  }
  return (
    <span className={cn(base)}>
      <span className="flex items-center gap-1.5">
        <span className="h-1.5 w-1.5 rounded-full bg-ok" />
        <span className="text-foreground font-medium">OK</span>
      </span>
      <span className="text-muted-foreground">·</span>
      <span className="text-foreground tabular-nums">{outcome.elapsed_ms}ms</span>
      <span className="text-muted-foreground">·</span>
      <span className="text-foreground tabular-nums">{sizeLabel}</span>
    </span>
  );
}
