import { Lock, Unlock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Kbd } from "@/components/ui/kbd";
import { Tooltip } from "@/components/ui/tooltip";
import { MethodPicker } from "@/features/shell/MethodPicker";
import type { SelectedMethod } from "@/features/shell/SelectedMethod";
import type { ResolutionReportIpc, ServiceCatalogIpc } from "@/ipc/bindings";
import { VarResolveLine, hasVars } from "@/features/vars/VarResolveLine";
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
  /** Resolves the address template for the under-bar preview; the caller bakes in the
   *  collection/env ctx. Omit to hide the preview (e.g. when there's nothing to resolve). */
  resolveAddress?: (t: string) => Promise<ResolutionReportIpc>;
  /** Extra resolve inputs (active env, env revision); change ⇒ re-resolve. */
  resolveKey?: string;
}

/** Editable Focus header for a draft: TLS lock + host → full-width MethodPicker → Send.
 *  Reflection status & reload live inside the MethodPicker dropdown (Postman-style). */
export function DraftAddressBar({
  step, catalog, reflecting, reflectError,
  onAddress, onTls, onRefresh, onSelectMethod, onSend, onCancel, onQuickAdd,
  resolveAddress, resolveKey,
}: DraftAddressBarProps) {
  const sending = step.status === "sending";
  return (
    <div className="border-b border-border">
    <div className="flex h-14 items-center gap-2 px-4">
      <div className="flex h-8 flex-none items-center gap-1.5 rounded-md border border-input bg-background pl-2 pr-1 focus-within:ring-1 focus-within:ring-ring">
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
          className="h-7 w-[22rem] border-0 bg-transparent px-1 font-mono text-xs focus-visible:ring-0"
        />
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
    {resolveAddress && hasVars(step.address) && (
      <div className="-mt-1 px-4 pb-1.5">
        <VarResolveLine value={step.address} resolver={resolveAddress} resolveKey={resolveKey} />
      </div>
    )}
    </div>
  );
}
