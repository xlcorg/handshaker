import { Lock, Unlock } from "lucide-react";
import { Tooltip } from "@/components/ui/tooltip";
import { MethodPicker } from "@/features/shell/MethodPicker";
import type { SelectedMethod } from "@/features/shell/SelectedMethod";
import type { MethodKind } from "@/lib/method-kind";
import type { ResolutionReportIpc, ServiceCatalogIpc } from "@/ipc/bindings";
import { VarHighlightInput } from "@/features/vars/VarHighlightInput";
import type { VarCandidate } from "@/features/vars/candidates";
import type { Step } from "./model";
import { effectiveTls, nextTlsState } from "./tls";
import { messages } from "@/lib/messages";
import { CallControls, type TwoWayControls } from "./CallControls";

export type { TwoWayControls } from "./CallControls";

export interface DraftAddressBarProps {
  step: Step;
  catalog: ServiceCatalogIpc | null;
  /** The **controls kind** the call panel derived (`controlsKind`: live call → catalog →
   *  last executed → null): badge + `▶ Send` / `▶ Open`. `null` ⇒ no badge, unary controls. */
  kind: MethodKind | null;
  reflecting: boolean;
  reflectError: string | null;
  onAddress: (address: string) => void;
  /** Tri-state: the lock cycles inherit(null) → on(true) → off(false) → inherit. */
  onTls: (tls: boolean | null) => void;
  /** Collection `default_tls` — what an inherited (null) override effectively is. */
  defaultTls: boolean;
  onRefresh: () => void;
  /** Abort the in-flight reflection (distinct from `onCancel`, which cancels a Send). */
  onReflectCancel: () => void;
  onSelectMethod: (m: SelectedMethod) => void;
  onSend: () => void;
  onCancel: () => void;
  /** Live two-way (client / bidi) call: the busy slot shows the segmented
   *  `[Send message ▸] [End stream] [Cancel]` instead of the lone Cancel; while opening
   *  and after half-close the first two disable, Cancel stays. Absent ⇒ lone Cancel
   *  (unary / server-streaming). Decided by the live entry's kind, not the catalog. */
  twoWay?: TwoWayControls;
  /** Hover «+» on a method row: one-click save to the collection. Omit to hide. */
  onQuickAdd?: (service: string, method: string) => void;
  /** Resolves the address template for in-field `{{var}}` highlighting + the field
   *  tooltip; the caller bakes in the collection/env ctx. Omit to disable highlighting. */
  resolveAddress?: (t: string) => Promise<ResolutionReportIpc>;
  /** Extra resolve inputs (active env, env revision); change ⇒ re-resolve. */
  resolveKey?: string;
  variables?: VarCandidate[];
}

/** Editable Focus header for a draft: TLS lock + host → full-width MethodPicker → one
 *  morphing control slot: `▶ Send` (unary / server-streaming) or `▶ Open` (client / bidi)
 *  idle; after the 250 ms busy gate `Cancel`, or the segmented two-way controls.
 *  Reflection status & reload live inside the MethodPicker dropdown (Postman-style).
 *  `{{var}}` tokens in the address are highlighted inline by resolve state (green =
 *  resolved, red = unresolved/cycle); the full resolved value is in the field tooltip. */
export function DraftAddressBar({
  step, catalog, kind, reflecting, reflectError,
  onAddress, onTls, defaultTls, onRefresh, onReflectCancel, onSelectMethod, onSend, onCancel, twoWay, onQuickAdd,
  resolveAddress, resolveKey, variables,
}: DraftAddressBarProps) {
  const inherit = step.tls === null;
  const tlsOn = effectiveTls(step.tls, defaultTls);
  return (
    <div className="flex h-14 items-center gap-2 border-b border-border px-4">
      <div className="flex h-8 flex-1 min-w-[16rem] items-center gap-1.5 rounded-md border border-input bg-background pl-2 pr-1 focus-within:ring-1 focus-within:ring-ring">
        <Tooltip content={messages.workflow.tls.tooltip(step.tls, defaultTls)}>
          <button
            type="button"
            onClick={() => onTls(nextTlsState(step.tls))}
            aria-label={messages.workflow.tls.aria(step.tls)}
            className={`flex flex-none items-center hover:text-foreground focus-visible:outline-none ${
              inherit ? "text-muted-foreground/60" : "text-foreground"
            }`}
          >
            {tlsOn ? <Lock className="size-3.5" /> : <Unlock className="size-3.5" />}
          </button>
        </Tooltip>
        <VarHighlightInput
          ariaLabel="draft-address"
          value={step.address}
          onChange={onAddress}
          placeholder={messages.workflow.addressBar.hostPlaceholder}
          resolver={resolveAddress}
          resolveKey={resolveKey}
          variables={variables}
          className="min-w-0 flex-1"
        />
      </div>
      <MethodPicker
        selected={{ service: step.service, method: step.method, kind: kind ?? "unary" }}
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
      <CallControls step={step} kind={kind} onSend={onSend} onCancel={onCancel} twoWay={twoWay} />
    </div>
  );
}
