import { useEffect, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { useBusyDelay } from "@/lib/use-busy-delay";
import { Activity } from "lucide-react";
import { ResponseBody } from "./ResponseBody";
import { EmptyState } from "./EmptyState";
import { ErrorView } from "./ErrorView";
import { ClientErrorView } from "./ClientErrorView";
import { KVTable, kvRows, type KVRow } from "./KVTable";
import { useTabBarStart } from "./useTabBarStart";
import { RespMeta, type RespState } from "./RespMeta";
import { UnderlineTabs } from "@/components/ui/underline-tabs";
import { ContractView } from "@/features/contract/ContractView";
import type { InvokeOutcomeIpc, MessageSchemaIpc } from "@/ipc/bindings";
import type { MethodKind } from "@/lib/method-kind";
import { messages } from "@/lib/messages";
import type { ClientFault } from "@/features/workflow/netDiagnostics";
import { isMacOS } from "@/lib/platform";
import { saveResponseToFile } from "./saveResponse";
import { isSaveResponseHotkey } from "./saveHotkey";

/** Editable-draft contract for the Contract tab. Omit/null → three tabs (history). */
export interface ContractInfo {
  input: MessageSchemaIpc | null;
  output: MessageSchemaIpc | null;
  method: string;
  /** Method kind derived live in the call panel; `null` while the catalog is unknown. */
  kind: MethodKind | null;
}

export interface ResponsePanelProps {
  state: RespState;
  outcome: InvokeOutcomeIpc | null;
  /** Client/transport fault (no gRPC outcome), shown in the Body tab. */
  error?: ClientFault | null;
  /** Method contract for the Contract tab; omit/null → three tabs (history panels). */
  contract?: ContractInfo | null;
}

type ResponseTab = "body" | "trailers" | "headers" | "contract";

export function ResponsePanel({ state, outcome, error, contract }: ResponsePanelProps) {
  const [tab, setTab] = useState<ResponseTab>("body");
  // Sending always pulls the view to Body — that's where the response lands.
  // Until then the default is Body; Contract is an explicit click away.
  useEffect(() => {
    if (state === "sending") setTab("body");
  }, [state]);

  const isError = state === "error";
  const sending = state === "sending";

  // Delay the in-flight progress indicator: fast responses shouldn't flash it
  // (a sub-threshold loader reads as a twitch). Same gate as the Send→Cancel
  // button swap (250ms) ⇒ comet and Cancel appear together.
  const showProgress = useBusyDelay(sending, 250);

  // Anchor the progress comet's first pass under the active tab.
  const { headerRef, barStart } = useTabBarStart(sending, tab);

  const trailers = kvRows(outcome?.trailing_metadata);
  // Backend doesn't surface initial-metadata yet; headers stays empty until it does.
  const headers: KVRow[] = [];

  // The full pretty body, available only on a successful response. Drives the
  // Ctrl/Cmd+S hotkey and the body context-menu action (Save response to file).
  const body = state === "success" && outcome?.response_json != null ? outcome.response_json : null;
  const onSaveBody = () => {
    if (body !== null) void saveResponseToFile(body);
  };
  const onKeyDown = (e: ReactKeyboardEvent) => {
    if (body !== null && isSaveResponseHotkey(e, isMacOS)) {
      e.preventDefault();
      onSaveBody();
    }
  };

  return (
    <div className="flex-1 flex flex-col min-w-0 min-h-0 bg-background relative" onKeyDown={onKeyDown}>
      <div
        ref={headerRef}
        className="h-10 flex-none flex items-center gap-2.5 px-3.5 border-b border-border relative z-10 bg-background/85 backdrop-blur-sm"
      >
        <UnderlineTabs
          value={tab}
          onChange={(v) => setTab(v as ResponseTab)}
          busy={showProgress}
          items={[
            { value: "body", label: messages.response.tabs.body },
            { value: "trailers", label: messages.response.tabs.trailers, hint: trailers.length || undefined },
            { value: "headers", label: messages.response.tabs.headers, hint: headers.length || undefined },
            ...(contract ? [{ value: "contract", label: messages.response.tabs.contract }] : []),
          ]}
        />
        <div className="ml-auto flex items-center gap-2.5">
          <RespMeta state={state} outcome={outcome} />
        </div>
        {showProgress && (
          <div
            aria-hidden
            data-testid="tab-progress"
            className="hs-tab-progress pointer-events-none absolute inset-x-0 -bottom-px h-[1.5px]"
            style={{ "--bar-start": `${barStart}px` } as CSSProperties}
          />
        )}
      </div>
      {state === "idle" && tab !== "contract" && (
        <EmptyState
          icon={<Activity className="size-[18px]" />}
          title={messages.response.empty.awaitingFirstCall}
          desc={messages.response.empty.awaitingFirstCallDesc}
        />
      )}
      {tab === "contract" && contract && (
        <div className="min-h-0 flex-1">
          <ContractView method={contract.method} input={contract.input} output={contract.output} kind={contract.kind} />
        </div>
      )}
      {state === "success" && outcome && tab === "body" && outcome.response_json !== null && (
        <div className="hs-fade-in flex min-h-0 flex-1 flex-col">
          <ResponseBody json={outcome.response_json} onSaveBody={onSaveBody} />
        </div>
      )}
      {state === "success" && outcome && tab === "trailers" && <KVTable rows={trailers} />}
      {state === "success" && outcome && tab === "headers" && <KVTable rows={headers} />}
      {isError && outcome && tab === "body" && (
        <div className="hs-fade-in flex min-h-0 flex-1 flex-col">
          <ErrorView outcome={outcome} />
        </div>
      )}
      {isError && !outcome && error && tab === "body" && (
        <div className="hs-fade-in flex min-h-0 flex-1 flex-col">
          <ClientErrorView fault={error} />
        </div>
      )}
      {isError && outcome && tab === "trailers" && <KVTable rows={trailers} />}
      {isError && outcome && tab === "headers" && <KVTable rows={headers} />}
    </div>
  );
}
