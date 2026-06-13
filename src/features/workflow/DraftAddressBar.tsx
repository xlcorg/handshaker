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

/** Compact display for the in-field resolve preview: the resolved value (truncated,
 *  full value in the title) or a short error marker (detail in the title). */
function resolveDisplay(report: ResolutionReportIpc): { text: string; title: string; error: boolean } {
  if (report.cycle_chain) {
    return { text: "⚠ cycle", title: `Cycle: ${report.cycle_chain.join(" → ")}`, error: true };
  }
  if (report.unresolved_vars.length > 0) {
    const list = report.unresolved_vars.join(", ");
    return { text: `⚠ ${list}`, title: `Unresolved: ${list}`, error: true };
  }
  return { text: report.resolved, title: report.resolved, error: false };
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
  const resolved = report ? resolveDisplay(report) : null;
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
        {resolved && (
          <>
            <span aria-hidden className="h-4 w-px flex-none bg-border" />
            <span
              className={cn(
                "max-w-[11rem] flex-none truncate font-mono text-xs",
                resolved.error ? "text-destructive" : "text-muted-foreground/80",
              )}
              title={resolved.title}
            >
              {resolved.text}
            </span>
          </>
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
