import { AlertCircle } from "lucide-react";
import { statusName } from "@/lib/grpc-status";
import type { InvokeOutcomeIpc } from "@/ipc/bindings";

export function ErrorBody({ outcome }: { outcome: InvokeOutcomeIpc }) {
  const code = statusName(outcome.status_code);
  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className="flex items-center gap-2.5 px-4 py-2.5 border-b border-border bg-destructive/5 text-destructive text-xs flex-none">
        <AlertCircle className="size-3.5" />
        <span className="font-mono">{code}</span>
        <span className="text-muted-foreground">·</span>
        <span className="text-foreground/85 break-all">{outcome.status_message}</span>
      </div>
      <pre className="flex-1 min-h-0 overflow-auto scroll-thin font-mono text-[12.5px] p-4 whitespace-pre-wrap text-foreground/85">
{`{
  "code": "${code}",
  "message": "${outcome.status_message.replace(/"/g, '\\"')}",
  "details": []
}`}
      </pre>
    </div>
  );
}
