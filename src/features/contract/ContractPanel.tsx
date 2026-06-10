import { useEffect, useState } from "react";
import { X } from "lucide-react";
import type { MessageSchemaIpc } from "@/ipc/bindings";
import { Button } from "@/components/ui/button";
import { UnderlineTabs } from "@/components/ui/underline-tabs";
import { ContractTree } from "./ContractTree";

export interface ContractPanelProps {
  open: boolean;
  onClose: () => void;
  /** Method display name for the header (plain name, not full path). */
  method: string;
  inputSchema: MessageSchemaIpc | null;
  outputSchema: MessageSchemaIpc | null;
}

type Side = "request" | "response";

/** Floating, read-only contract reference over the request pane. Deliberately NO
 *  click-outside dismissal — the core scenario is typing in the editor while the
 *  panel stays open. Esc closes it unless something (e.g. Monaco's suggest widget)
 *  already consumed the keydown. */
export function ContractPanel({
  open,
  onClose,
  method,
  inputSchema,
  outputSchema,
}: ContractPanelProps) {
  const [side, setSide] = useState<Side>("request");

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !e.defaultPrevented) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;
  const schema = side === "request" ? inputSchema : outputSchema;

  return (
    <div
      role="dialog"
      aria-label="Method contract"
      className="absolute right-2 top-12 z-20 flex max-h-[70%] w-80 flex-col overflow-hidden rounded-lg border border-border bg-popover shadow-lg"
    >
      <div className="flex h-9 flex-none items-center gap-2 border-b border-border px-3">
        <span className="truncate text-xs font-medium">{method || "Contract"}</span>
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={onClose}
          aria-label="Close contract"
          className="ml-auto text-muted-foreground hover:text-foreground"
        >
          <X />
        </Button>
      </div>
      <div className="flex h-8 flex-none items-center border-b border-border px-2">
        <UnderlineTabs<Side>
          value={side}
          onChange={setSide}
          items={[
            { value: "request", label: "Request" },
            { value: "response", label: "Response" },
          ]}
        />
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {schema ? (
          <ContractTree schema={schema} />
        ) : (
          <div className="px-3 py-3 text-xs text-muted-foreground">
            Контракт недоступен — схема метода не получена (reflection выключен или
            сервер недоступен).
          </div>
        )}
      </div>
    </div>
  );
}
