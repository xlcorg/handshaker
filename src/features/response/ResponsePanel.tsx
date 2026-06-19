import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { ChevronsDownUp, ChevronsUpDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useBusyDelay } from "@/lib/use-busy-delay";
import { Activity } from "lucide-react";
import { ResponseBody } from "./ResponseBody";
import type { BodyViewHandle } from "@/features/bodyview/BodyView";
import { EmptyState } from "./EmptyState";
import { ErrorView } from "./ErrorView";
import { ClientErrorView } from "./ClientErrorView";
import { KVTable, type KVRow } from "./KVTable";
import { RespMeta, type RespState } from "./RespMeta";
import { UnderlineTabs } from "@/components/ui/underline-tabs";
import { ContractView } from "@/features/contract/ContractView";
import type { InvokeOutcomeIpc, MessageSchemaIpc } from "@/ipc/bindings";

/** Editable-draft contract for the Contract tab. Omit/null → three tabs (history). */
export interface ContractInfo {
  input: MessageSchemaIpc | null;
  output: MessageSchemaIpc | null;
  method: string;
}

export interface ResponsePanelProps {
  state: RespState;
  outcome: InvokeOutcomeIpc | null;
  /** Client/transport error message (no gRPC outcome), shown in the Body tab. */
  error?: string | null;
  /** Method contract for the Contract tab; omit/null → three tabs (history panels). */
  contract?: ContractInfo | null;
}

type ResponseTab = "body" | "trailers" | "headers" | "contract";

export function ResponsePanel({ state, outcome, error, contract }: ResponsePanelProps) {
  const [tab, setTab] = useState<ResponseTab>("body");
  const bodyRef = useRef<BodyViewHandle>(null);
  // Sending always pulls the view to Body — that's where the response lands.
  // Until then the default is Body; Contract is an explicit click away.
  useEffect(() => {
    if (state === "sending") setTab("body");
  }, [state]);

  const isError = state === "error";
  const sending = state === "sending";

  // The collapse/expand controls only make sense over the foldable JSON tree —
  // the same condition that renders <ResponseBody> below.
  const showBodyTools = state === "success" && !!outcome && tab === "body" && outcome.response_json !== null;

  // Delay the in-flight progress indicator: fast responses shouldn't flash it
  // (a sub-threshold loader reads as a twitch). Same gate as the Send→Cancel
  // button swap (250ms) ⇒ comet and Cancel appear together.
  const showProgress = useBusyDelay(sending, 250);

  // Anchor the progress comet's first pass under the active tab. Measure the tab's
  // left relative to the header via bounding rects (NOT offsetLeft — the tab strip is
  // `relative`, so it is the tabs' offsetParent and offsetLeft would be ~0 here).
  const headerRef = useRef<HTMLDivElement>(null);
  const [barStart, setBarStart] = useState(0);
  useLayoutEffect(() => {
    if (!sending) return;
    const header = headerRef.current;
    const activeTab = header?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]');
    if (header && activeTab) {
      setBarStart(activeTab.getBoundingClientRect().left - header.getBoundingClientRect().left);
    }
  }, [sending, tab]);

  const trailers: KVRow[] = outcome
    ? Object.entries(outcome.trailing_metadata).map(([k, v]) => ({ k, v: v ?? "" }))
    : [];
  // Backend doesn't surface initial-metadata yet; headers stays empty until it does.
  const headers: KVRow[] = [];

  return (
    <div className="flex-1 flex flex-col min-w-0 min-h-0 bg-background relative">
      <div
        ref={headerRef}
        className="h-10 flex-none flex items-center gap-2.5 px-3.5 border-b border-border relative z-10 bg-background/85 backdrop-blur-sm"
      >
        <UnderlineTabs
          value={tab}
          onChange={(v) => setTab(v as ResponseTab)}
          busy={showProgress}
          items={[
            { value: "body", label: "Body" },
            { value: "trailers", label: "Trailers", hint: trailers.length || undefined },
            { value: "headers", label: "Headers", hint: headers.length || undefined },
            ...(contract ? [{ value: "contract", label: "Contract" }] : []),
          ]}
        />
        <div className="ml-auto flex items-center gap-2.5">
          {showBodyTools && (
            <div className="flex items-center gap-1">
              <Button
                size="icon-sm"
                variant="ghost"
                className="size-5 text-muted-foreground"
                aria-label="collapse all"
                title="Collapse all"
                onClick={() => bodyRef.current?.collapseAll()}
              >
                <ChevronsDownUp className="size-3.5" />
              </Button>
              <Button
                size="icon-sm"
                variant="ghost"
                className="size-5 text-muted-foreground"
                aria-label="expand all"
                title="Expand all"
                onClick={() => bodyRef.current?.expandAll()}
              >
                <ChevronsUpDown className="size-3.5" />
              </Button>
            </div>
          )}
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
          title="Awaiting first call"
          desc="Hit Send to invoke. Response body, trailers and timing will appear here."
        />
      )}
      {tab === "contract" && contract && (
        <div className="min-h-0 flex-1">
          <ContractView method={contract.method} input={contract.input} output={contract.output} />
        </div>
      )}
      {state === "success" && outcome && tab === "body" && outcome.response_json !== null && (
        <div className="hs-fade-in flex min-h-0 flex-1 flex-col">
          <ResponseBody ref={bodyRef} json={outcome.response_json} />
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
          <ClientErrorView message={error} />
        </div>
      )}
      {isError && outcome && tab === "trailers" && <KVTable rows={trailers} />}
      {isError && outcome && tab === "headers" && <KVTable rows={headers} />}
    </div>
  );
}
