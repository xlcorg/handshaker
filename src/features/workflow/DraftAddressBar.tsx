import { Lock, Unlock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { Tooltip } from "@/components/ui/tooltip";
import { MethodPicker } from "@/features/shell/MethodPicker";
import type { SelectedMethod } from "@/features/shell/SelectedMethod";
import type { ResolutionReportIpc, ServiceCatalogIpc } from "@/ipc/bindings";
import { VarHighlightInput } from "@/features/vars/VarHighlightInput";
import { useBusyDelay } from "@/lib/use-busy-delay";
import type { VarCandidate } from "@/features/vars/candidates";
import type { Step } from "./model";

export interface DraftAddressBarProps {
  step: Step;
  catalog: ServiceCatalogIpc | null;
  reflecting: boolean;
  reflectError: string | null;
  onAddress: (address: string) => void;
  onTls: (tls: boolean) => void;
  onRefresh: () => void;
  /** Abort the in-flight reflection (distinct from `onCancel`, which cancels a Send). */
  onReflectCancel: () => void;
  onSelectMethod: (m: SelectedMethod) => void;
  onSend: () => void;
  onCancel: () => void;
  /** Hover «+» on a method row: one-click save to the collection. Omit to hide. */
  onQuickAdd?: (service: string, method: string) => void;
  /** Resolves the address template for in-field `{{var}}` highlighting + the field
   *  tooltip; the caller bakes in the collection/env ctx. Omit to disable highlighting. */
  resolveAddress?: (t: string) => Promise<ResolutionReportIpc>;
  /** Extra resolve inputs (active env, env revision); change ⇒ re-resolve. */
  resolveKey?: string;
  variables?: VarCandidate[];
}

/** Editable Focus header for a draft: TLS lock + host → full-width MethodPicker → Send.
 *  Reflection status & reload live inside the MethodPicker dropdown (Postman-style).
 *  `{{var}}` tokens in the address are highlighted inline by resolve state (green =
 *  resolved, red = unresolved/cycle); the full resolved value is in the field tooltip. */
export function DraftAddressBar({
  step, catalog, reflecting, reflectError,
  onAddress, onTls, onRefresh, onReflectCancel, onSelectMethod, onSend, onCancel, onQuickAdd,
  resolveAddress, resolveKey, variables,
}: DraftAddressBarProps) {
  const sending = step.status === "sending";
  // Delay the Send→Cancel swap so a sub-250ms call never twitches the button.
  // Same 250ms as the response comet (ResponsePanel) ⇒ they appear in lockstep.
  const showCancel = useBusyDelay(sending, 250);
  return (
    <div className="flex h-14 items-center gap-2 border-b border-border px-4">
      <div className="flex h-8 flex-1 min-w-[16rem] items-center gap-1.5 rounded-md border border-input bg-background pl-2 pr-1 focus-within:ring-1 focus-within:ring-ring">
        <Tooltip
          content={step.tls ? "TLS enabled — click to switch to plaintext" : "Plaintext — click to enable TLS"}
        >
          <button
            type="button"
            onClick={() => onTls(!step.tls)}
            aria-label={step.tls ? "TLS enabled" : "Plaintext"}
            className="flex flex-none items-center text-muted-foreground hover:text-foreground focus-visible:outline-none"
          >
            {step.tls ? <Lock className="size-3.5" /> : <Unlock className="size-3.5" />}
          </button>
        </Tooltip>
        <VarHighlightInput
          ariaLabel="draft-address"
          value={step.address}
          onChange={onAddress}
          placeholder="host:port"
          resolver={resolveAddress}
          resolveKey={resolveKey}
          variables={variables}
          className="min-w-0 flex-1"
        />
      </div>
      <MethodPicker
        selected={{ service: step.service, method: step.method, kind: "unary" }}
        catalog={catalog}
        onSelect={onSelectMethod}
        reflection={
          step.address.trim()
            ? { loading: reflecting, error: reflectError, onRefresh, onCancel: onReflectCancel }
            : undefined
        }
        className="flex-1 min-w-0"
        onQuickAdd={onQuickAdd}
      />
      {showCancel ? (
        <Button size="sm" variant="ghost" onClick={onCancel} className="min-w-[5rem] text-muted-foreground">
          Cancel
        </Button>
      ) : (
        <Tooltip content={<span><Kbd>Ctrl</Kbd> <Kbd>Enter</Kbd></span>}>
          <Button
            size="sm"
            onClick={onSend}
            disabled={step.method.trim().length === 0}
            className="min-w-[5rem] active:scale-[.97]"
          >
            ▶ Send
          </Button>
        </Tooltip>
      )}
    </div>
  );
}
