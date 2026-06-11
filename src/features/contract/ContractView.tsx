import { useMemo } from "react";
import type { MessageSchemaIpc } from "@/ipc/bindings";
import { cn } from "@/lib/cn";
import { renderProtoDoc } from "./proto";
import { ProtoView } from "./ProtoView";

export type ContractSide = "request" | "response";

export interface ContractViewProps {
  /** Method display name (plain name, not full path); empty → "pick a method" hint. */
  method: string;
  input: MessageSchemaIpc | null;
  output: MessageSchemaIpc | null;
  side: ContractSide;
  onSide: (side: ContractSide) => void;
}

const SIDES: { value: ContractSide; label: string }[] = [
  { value: "request", label: "Request" },
  { value: "response", label: "Response" },
];

/** Contract-tab content: Request|Response segmented switch + proto listing.
 *  Side state lives in the parent so it survives Response-panel tab switches. */
export function ContractView({ method, input, output, side, onSide }: ContractViewProps) {
  const schema = side === "request" ? input : output;
  const doc = useMemo(() => (schema ? renderProtoDoc(schema) : null), [schema]);
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-8 flex-none items-center gap-2 border-b border-border px-3.5">
        <div className="flex items-center overflow-hidden rounded-md border border-border text-xs">
          {SIDES.map((s) => (
            <button
              key={s.value}
              type="button"
              aria-pressed={side === s.value}
              onClick={() => onSide(s.value)}
              className={cn(
                "px-2.5 py-0.5",
                side === s.value ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {s.label}
            </button>
          ))}
        </div>
        <span className="ml-auto truncate font-mono text-[11px] text-muted-foreground">{method}</span>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {method.trim().length === 0 ? (
          <div className="px-3.5 py-3 text-xs text-muted-foreground">
            Выбери метод — его контракт появится здесь.
          </div>
        ) : doc ? (
          <ProtoView doc={doc} />
        ) : (
          <div className="px-3.5 py-3 text-xs text-muted-foreground">
            Контракт недоступен — схема метода не получена (reflection выключен или
            сервер недоступен).
          </div>
        )}
      </div>
    </div>
  );
}
