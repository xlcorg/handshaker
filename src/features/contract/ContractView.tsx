import { useMemo } from "react";
import type { MessageSchemaIpc } from "@/ipc/bindings";
import type { MethodKind } from "@/lib/method-kind";
import { renderContractDoc } from "./proto";
import { ProtoView } from "./ProtoView";
import { messages } from "@/lib/messages";

export interface ContractViewProps {
  /** Method display name (plain name, not full path); empty → "pick a method" hint. */
  method: string;
  input: MessageSchemaIpc | null;
  output: MessageSchemaIpc | null;
  /** Method kind derived live from the catalog; `null` (unknown) omits the `rpc` line. */
  kind: MethodKind | null;
}

/** Contract-tab content: the whole method contract in one listing — an `rpc`
 *  signature line plus both sides' types, shared types printed once. */
export function ContractView({ method, input, output, kind }: ContractViewProps) {
  const doc = useMemo(
    () => (input !== null || output !== null ? renderContractDoc(method, input, output, kind) : null),
    [method, input, output, kind],
  );
  return (
    <div className="h-full min-h-0 overflow-auto">
      {method.trim().length === 0 ? (
        <div className="px-3.5 py-3 text-xs text-muted-foreground">
          {messages.contract.pickMethod}
        </div>
      ) : doc ? (
        <>
          <ProtoView doc={doc} />
          {(input === null || output === null) && (
            <div className="px-3.5 pb-3 text-xs text-muted-foreground">
              {messages.contract.schemaUnavailable(input === null ? "input" : "output")}
            </div>
          )}
        </>
      ) : (
        <div className="px-3.5 py-3 text-xs text-muted-foreground">
          {messages.contract.unavailable}
        </div>
      )}
    </div>
  );
}
