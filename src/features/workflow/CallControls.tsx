import { ArrowRightToLine } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { Tooltip } from "@/components/ui/tooltip";
import { isTwoWay, type MethodKind } from "@/lib/method-kind";
import { useBusyDelay } from "@/lib/use-busy-delay";
import { messages } from "@/lib/messages";
import type { Step } from "./model";

export interface TwoWayControls {
  /** Send message / Half-close enabled: `Opened` arrived and the outbound side is not
   *  yet half-closed. False while opening and after half-close (Cancel stays). */
  canSend: boolean;
  onSendMessage: () => void;
  onHalfClose: () => void;
}

export interface CallControlsProps {
  step: Step;
  /** The **controls kind** (`controlsKind`): picks the idle label — `▶ Send` (unary /
   *  server-streaming / unknown) or `▶ Open` (client / bidi). */
  kind: MethodKind | null;
  onSend: () => void;
  onCancel: () => void;
  /** Live two-way (client / bidi) call: the busy slot shows the segmented
   *  `[Send message ▸] [End stream] [Cancel]` instead of the lone Cancel; while opening
   *  and after half-close the first two disable, Cancel stays. Absent ⇒ lone Cancel
   *  (unary / server-streaming). Decided by the live entry's kind, not the catalog. */
  twoWay?: TwoWayControls;
}

/** The one morphing control slot shared by the draft header and the read-only history
 *  header: `▶ Send` / `▶ Open` idle; after the 250 ms busy gate `Cancel`, or the
 *  segmented two-way controls. */
export function CallControls({ step, kind, onSend, onCancel, twoWay }: CallControlsProps) {
  const sending = step.status === "sending";
  // Delay the Send→Cancel swap so a sub-250ms call never twitches the button.
  // Same 250ms as the response comet (ResponsePanel) ⇒ they appear in lockstep.
  const showCancel = useBusyDelay(sending, 250);
  const primaryLabel = isTwoWay(kind) ? messages.workflow.addressBar.open : messages.workflow.addressBar.send;
  if (showCancel && twoWay) {
    return (
      <div role="group" aria-label={messages.workflow.addressBar.streamControlsAria} className="flex items-center gap-1">
        <Tooltip content={<span><Kbd>Ctrl</Kbd> <Kbd>Enter</Kbd></span>}>
          <Button
            size="sm"
            onClick={twoWay.onSendMessage}
            disabled={!twoWay.canSend}
            className="active:scale-[.97]"
          >
            {messages.workflow.addressBar.sendMessage}
          </Button>
        </Tooltip>
        <Button size="sm" variant="outline" onClick={twoWay.onHalfClose} disabled={!twoWay.canSend}>
          <ArrowRightToLine aria-hidden="true" />
          {messages.workflow.addressBar.halfClose}
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel} className="text-muted-foreground">
          {messages.workflow.addressBar.cancel}
        </Button>
      </div>
    );
  }
  if (showCancel) {
    return (
      <Button size="sm" variant="ghost" onClick={onCancel} className="min-w-[5rem] text-muted-foreground">
        {messages.workflow.addressBar.cancel}
      </Button>
    );
  }
  return (
    <Tooltip content={<span><Kbd>Ctrl</Kbd> <Kbd>Enter</Kbd> · <Kbd>Ctrl</Kbd> <Kbd>R</Kbd></span>}>
      <Button
        size="sm"
        onClick={onSend}
        disabled={step.method.trim().length === 0}
        className="min-w-[5rem] active:scale-[.97]"
      >
        {primaryLabel}
      </Button>
    </Tooltip>
  );
}
