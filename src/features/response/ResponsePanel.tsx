import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { Activity } from "lucide-react";
import { ResponseBody } from "./ResponseBody";
import { EmptyState } from "./EmptyState";
import { ErrorView } from "./ErrorView";
import { ClientErrorView } from "./ClientErrorView";
import { KVTable, type KVRow } from "./KVTable";
import { RespMeta, type RespState } from "./RespMeta";
import { UnderlineTabs } from "@/components/ui/underline-tabs";
import type { InvokeOutcomeIpc } from "@/ipc/bindings";

export interface ResponsePanelProps {
  state: RespState;
  outcome: InvokeOutcomeIpc | null;
  /** Client/transport error message (no gRPC outcome), shown in the Body tab. */
  error?: string | null;
}

type ResponseTab = "body" | "trailers" | "headers";

export function ResponsePanel({ state, outcome, error }: ResponsePanelProps) {
  const [tab, setTab] = useState<ResponseTab>("body");
  const isError = state === "error";
  const sending = state === "sending";

  // Delay the in-flight progress indicator: fast responses shouldn't flash it
  // (a sub-threshold loader reads as a twitch). Gates both the comet and the
  // tab-underline fade so they stay in lockstep.
  const [showProgress, setShowProgress] = useState(false);
  useEffect(() => {
    if (!sending) {
      setShowProgress(false);
      return;
    }
    const t = setTimeout(() => setShowProgress(true), 250);
    return () => clearTimeout(t);
  }, [sending]);

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
      {state === "idle" && (
        <EmptyState
          icon={<Activity className="size-[18px]" />}
          title="Awaiting first call"
          desc="Hit Send to invoke. Response body, trailers and timing will appear here."
        />
      )}
      {state === "success" && outcome && tab === "body" && outcome.response_json !== null && (
        <ResponseBody json={outcome.response_json} />
      )}
      {state === "success" && outcome && tab === "trailers" && <KVTable rows={trailers} />}
      {state === "success" && outcome && tab === "headers" && <KVTable rows={headers} />}
      {isError && outcome && tab === "body" && <ErrorView outcome={outcome} />}
      {isError && !outcome && error && tab === "body" && <ClientErrorView message={error} />}
      {isError && outcome && tab === "trailers" && <KVTable rows={trailers} />}
      {isError && outcome && tab === "headers" && <KVTable rows={headers} />}
    </div>
  );
}
