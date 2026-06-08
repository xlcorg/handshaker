import { Lock, Unlock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Kbd } from "@/components/ui/kbd";
import { Tooltip } from "@/components/ui/tooltip";
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
  onTls: (tls: boolean) => void;
  onRefresh: () => void;
  onSelectMethod: (m: SelectedMethod) => void;
  onSend: () => void;
  onCancel: () => void;
}

/** Editable Focus header for a draft: TLS lock + host → full-width MethodPicker → Send.
 *  Reflection status & reload live inside the MethodPicker dropdown (Postman-style). */
export function DraftAddressBar({
  step, catalog, reflecting, reflectError,
  onAddress, onTls, onRefresh, onSelectMethod, onSend, onCancel,
}: DraftAddressBarProps) {
  const sending = step.status === "sending";
  return (
    <div className="flex h-14 items-center gap-2 border-b border-border px-4">
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
