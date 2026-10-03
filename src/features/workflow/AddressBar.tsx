import { cn } from "@/lib/cn";
import type { MethodKind } from "@/lib/method-kind";
import { useStreamEntry } from "@/features/stream/streamStore";
import { CallControls, type TwoWayControls } from "./CallControls";
import type { Step } from "./model";
import { statusChip, TONE_TEXT } from "./stepView";

/** Read-only history header: method · address / service · status chip · the call
 *  controls. No kind badge here — the row (`StepRow`), the timeline and the footer already
 *  say "stream"; the controls still follow `kind` (`▶ Open` for a client / bidi snapshot). */
export function AddressBar({
  step,
  kind,
  onSend,
  onCancel,
  twoWay,
}: {
  step: Step;
  /** The **controls kind** (`controlsKind`) — for a history snapshot the executed kind. */
  kind: MethodKind | null;
  onSend: () => void;
  onCancel: () => void;
  twoWay?: TwoWayControls;
}) {
  // Stream snapshots read their End / Cancel off the store entry (`outcome` is unary-only).
  const chip = statusChip(step, useStreamEntry(step.streamId));
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
      {chip ? <span className={cn("text-xs", TONE_TEXT[chip.tone])}>{chip.text}</span> : null}
      <CallControls step={step} kind={kind} onSend={onSend} onCancel={onCancel} twoWay={twoWay} />
    </div>
  );
}
