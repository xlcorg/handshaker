import { Lock, Unlock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Kbd } from "@/components/ui/kbd";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/cn";
import { MethodPicker } from "@/features/shell/MethodPicker";
import type { SelectedMethod } from "@/features/shell/SelectedMethod";
import type { ResolutionReportIpc, ServiceCatalogIpc } from "@/ipc/bindings";
import { useVarResolve } from "@/features/vars/useVarResolve";
import type { Step } from "./model";

export interface DraftAddressBarProps {
  step: Step;
  catalog: ServiceCatalogIpc | null;
  reflecting: boolean;
  reflectError: string | null;
  onAddress: (address: string) => void;
  onTls: (tls: boolean) => void;
  onRefresh: () => void;
  onSelectMethod: (m: SelectedMethod) => void;
  onSend: () => void;
  onCancel: () => void;
  /** Hover «+» on a method row: one-click save to the collection. Omit to hide. */
  onQuickAdd?: (service: string, method: string) => void;
  /** Resolves the address template for the inline preview; the caller bakes in the
   *  collection/env ctx. Omit to hide the preview (e.g. when there's nothing to resolve). */
  resolveAddress?: (t: string) => Promise<ResolutionReportIpc>;
  /** Extra resolve inputs (active env, env revision); change ⇒ re-resolve. */
  resolveKey?: string;
}

/** Below this address length we assume the field has free space for the inline
 *  resolved value (monospace ⇒ char count tracks width). Longer ⇒ inline is dropped
 *  and the marker's tooltip carries the value. Heuristic; tune against the live field. */
const INLINE_RESOLVE_MAX_CHARS = 28;

/** Resolve state for the field marker + (optional) inline value. `value` is the
 *  resolved string on success (shown inline when there's room), null on error;
 *  `title` is the always-available tooltip text (value or error detail). */
function resolveInfo(report: ResolutionReportIpc): { value: string | null; title: string; error: boolean } {
  if (report.cycle_chain) {
    return { value: null, title: `Cycle: ${report.cycle_chain.join(" → ")}`, error: true };
  }
  if (report.unresolved_vars.length > 0) {
    return { value: null, title: `Unresolved: ${report.unresolved_vars.join(", ")}`, error: true };
  }
  return { value: report.resolved, title: report.resolved, error: false };
}

/** Editable Focus header for a draft: TLS lock + host → full-width MethodPicker → Send.
 *  Reflection status & reload live inside the MethodPicker dropdown (Postman-style).
 *  When the address has `{{vars}}`, the resolved value shows inline inside the field
 *  (truncated, full value on hover) — see {@link useVarResolve}. */
export function DraftAddressBar({
  step, catalog, reflecting, reflectError,
  onAddress, onTls, onRefresh, onSelectMethod, onSend, onCancel, onQuickAdd,
  resolveAddress, resolveKey,
}: DraftAddressBarProps) {
  const sending = step.status === "sending";
  const report = useVarResolve(step.address, resolveAddress, resolveKey);
  const resolve = report ? resolveInfo(report) : null;
  // Inline value only when it's a success AND the address is short enough to leave room.
  const showInline = resolve?.value != null && step.address.length <= INLINE_RESOLVE_MAX_CHARS;
  return (
    <div className="flex h-14 items-center gap-2 border-b border-border px-4">
      <div className="flex h-8 w-[24rem] flex-none items-center gap-1.5 rounded-md border border-input bg-background pl-2 pr-2 focus-within:ring-1 focus-within:ring-ring">
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
        <Input
          aria-label="draft-address"
          value={step.address}
          onChange={(e) => onAddress(e.target.value)}
          placeholder="host:port"
          className="h-7 min-w-0 flex-1 border-0 bg-transparent px-1 font-mono text-xs focus-visible:ring-0"
        />
        {showInline && (
          <>
            <span aria-hidden className="h-4 w-px flex-none bg-border" />
            <span
              className="max-w-[11rem] flex-none truncate font-mono text-xs text-muted-foreground/80"
              title={resolve!.title}
            >
              {resolve!.value}
            </span>
          </>
        )}
        {resolve && (
          <span
            role="img"
            aria-label={resolve.error ? "address resolve error" : "address resolved"}
            title={resolve.title}
            className={cn(
              "size-2 flex-none rounded-full",
              resolve.error ? "bg-destructive" : "bg-emerald-500",
            )}
          />
        )}
      </div>
      <MethodPicker
        selected={{ service: step.service, method: step.method, kind: "unary" }}
        catalog={catalog}
        onSelect={onSelectMethod}
        reflection={
          step.address.trim() ? { loading: reflecting, error: reflectError, onRefresh } : undefined
        }
        className="flex-1"
        onQuickAdd={onQuickAdd}
      />
      {sending ? (
        <Button size="sm" variant="ghost" onClick={onCancel} className="text-muted-foreground">
          Cancel
        </Button>
      ) : (
        <Tooltip content={<span>Send <Kbd>Ctrl</Kbd> <Kbd>Enter</Kbd></span>}>
          <Button size="sm" onClick={onSend} disabled={step.method.trim().length === 0}>
            ▶ Send
          </Button>
        </Tooltip>
      )}
    </div>
  );
}
