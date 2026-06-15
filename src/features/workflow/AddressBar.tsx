import { Button } from "@/components/ui/button";
import { useBusyDelay } from "@/lib/use-busy-delay";
import type { Step } from "./model";

export function AddressBar({
  step,
  onSend,
  onCancel,
}: {
  step: Step;
  onSend: () => void;
  onCancel: () => void;
}) {
  const sending = step.status === "sending";
  const showCancel = useBusyDelay(sending, 250); // mirror the draft bar + comet gate
  return (
    <div className="flex h-14 items-center gap-3 border-b border-border px-4">
      <span className="text-ok" aria-hidden>
        🔒
      </span>
      <span className="font-mono text-[13px] font-semibold text-foreground">
        {step.method}
      </span>
      <span className="truncate font-mono text-xs text-muted-foreground">
        {step.address} / {step.service}
      </span>
      <div className="flex-1" />
      {step.status === "ok" && step.outcome ? (
        <span className="text-xs text-ok">
          ✓ OK · {step.outcome.elapsed_ms}ms
        </span>
      ) : null}
      {step.status === "error" ? (
        <span className="text-xs text-destructive">✕ error</span>
      ) : null}
      {showCancel ? (
        <Button size="sm" variant="ghost" onClick={onCancel} className="min-w-[5rem] text-muted-foreground">
          Cancel
        </Button>
      ) : (
        <Button size="sm" onClick={onSend} className="min-w-[5rem] active:scale-[.97]">
          ▶ Send
        </Button>
      )}
    </div>
  );
}
