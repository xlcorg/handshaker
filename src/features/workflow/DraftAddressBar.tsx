import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/cn";
import { MethodPicker } from "@/features/shell/MethodPicker";
import type { SelectedMethod } from "@/features/shell/SelectedMethod";
import type { ServiceCatalogIpc } from "@/ipc/bindings";
import type { Step } from "./model";

export interface DraftAddressBarProps {
  step: Step;
  catalog: ServiceCatalogIpc | null;
  reflecting: boolean;
  reflectError: string | null;
  onAddress: (address: string) => void;
  onRefresh: () => void;
  onSelectMethod: (m: SelectedMethod) => void;
  onSend: () => void;
  onCancel: () => void;
}

/** Editable Focus header for a draft: host input → reflection → MethodPicker → Send. */
export function DraftAddressBar({
  step, catalog, reflecting, reflectError, onAddress, onRefresh, onSelectMethod, onSend, onCancel,
}: DraftAddressBarProps) {
  const sending = step.status === "sending";
  return (
    <div className="flex h-14 items-center gap-2 border-b border-border px-4">
      <Input
        aria-label="draft-address"
        value={step.address}
        onChange={(e) => onAddress(e.target.value)}
        placeholder="host:port"
        className="h-8 w-56 font-mono text-xs"
      />
      <Button
        type="button"
        size="icon"
        variant="ghost"
        aria-label="refresh-reflection"
        onClick={onRefresh}
        disabled={reflecting || step.address.trim().length === 0}
      >
        <RefreshCw className={cn("size-3.5", reflecting && "animate-spin")} />
      </Button>
      {catalog ? (
        <MethodPicker
          selected={{ service: step.service, method: step.method, kind: "unary" }}
          catalog={catalog}
          onSelect={onSelectMethod}
        />
      ) : (
        <span className="truncate text-xs text-muted-foreground">
          {reflecting ? "Reflecting…" : reflectError ? reflectError : "Enter a host to load methods"}
        </span>
      )}
      <div className="flex-1" />
      {sending ? (
        <Button size="sm" variant="outline" onClick={onCancel}>
          ✕ Cancel
        </Button>
      ) : null}
      <Button size="sm" onClick={onSend} disabled={sending || step.method.trim().length === 0}>
        {sending ? "Sending…" : "▶ Send"}
      </Button>
    </div>
  );
}
