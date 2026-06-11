import { useMemo } from "react";
import type { MessageSchemaIpc } from "@/ipc/bindings";
import { renderContractDoc } from "./proto";
import { ProtoView } from "./ProtoView";

export interface ContractViewProps {
  /** Method display name (plain name, not full path); empty → "pick a method" hint. */
  method: string;
  input: MessageSchemaIpc | null;
  output: MessageSchemaIpc | null;
}

/** Contract-tab content: the whole method contract in one listing — an `rpc`
 *  signature line plus both sides' types, shared types printed once. */
export function ContractView({ method, input, output }: ContractViewProps) {
  const doc = useMemo(
    () => (input !== null || output !== null ? renderContractDoc(method, input, output) : null),
    [method, input, output],
  );
  return (
    <div className="h-full min-h-0 overflow-auto">
      {method.trim().length === 0 ? (
        <div className="px-3.5 py-3 text-xs text-muted-foreground">
          Выбери метод — его контракт появится здесь.
        </div>
      ) : doc ? (
        <>
          <ProtoView doc={doc} />
          {(input === null || output === null) && (
            <div className="px-3.5 pb-3 text-xs text-muted-foreground">
              {input === null ? "Request" : "Response"}-схема недоступна.
            </div>
          )}
        </>
      ) : (
        <div className="px-3.5 py-3 text-xs text-muted-foreground">
          Контракт недоступен — схема метода не получена (reflection выключен или
          сервер недоступен).
        </div>
      )}
    </div>
  );
}
