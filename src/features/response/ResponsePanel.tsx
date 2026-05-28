import { useState } from "react";
import { Activity } from "lucide-react";
import { BodyView } from "./BodyView";
import { EmptyState } from "./EmptyState";
import { ErrorBody } from "./ErrorBody";
import { KVTable, type KVRow } from "./KVTable";
import { RespMeta, type RespState } from "./RespMeta";
import { UnderlineTabs } from "@/components/ui/underline-tabs";
import type { InvokeOutcomeIpc } from "@/ipc/bindings";

export interface ResponsePanelProps {
  state: RespState;
  outcome: InvokeOutcomeIpc | null;
}

type ResponseTab = "body" | "trailers" | "headers";

export function ResponsePanel({ state, outcome }: ResponsePanelProps) {
  const [tab, setTab] = useState<ResponseTab>("body");
  const isError = state === "error";
  const trailers: KVRow[] = outcome
    ? Object.entries(outcome.trailing_metadata).map(([k, v]) => ({ k, v: v ?? "" }))
    : [];
  // Backend doesn't surface initial-metadata yet; headers stays empty until it does.
  const headers: KVRow[] = [];

  return (
    <div className="flex-1 flex flex-col min-w-0 min-h-0 bg-background relative">
      <div className="h-10 flex-none flex items-center gap-2.5 px-3.5 border-b border-border relative z-10 bg-background/85 backdrop-blur-sm">
        <UnderlineTabs
          value={tab}
          onChange={(v) => setTab(v as ResponseTab)}
          items={[
            { value: "body", label: "Body" },
            { value: "trailers", label: "Trailers", hint: trailers.length || undefined },
            { value: "headers", label: "Headers", hint: headers.length || undefined },
          ]}
        />
        <div className="ml-auto flex items-center gap-2.5">
          <RespMeta state={state} outcome={outcome} />
        </div>
      </div>
      {state === "idle" && (
        <EmptyState
          icon={<Activity className="size-4" />}
          title="Awaiting first call"
          desc="Hit Send to invoke. Response body, trailers and timing will appear here."
        />
      )}
      {state === "sending" && (
        <EmptyState
          icon={<span className="spinner" style={{ width: 18, height: 18 }} />}
          title="Sending request…"
          desc="Establishing channel and serializing message."
        />
      )}
      {state === "success" && outcome && tab === "body" && outcome.response_json !== null && (
        <BodyView json={outcome.response_json} />
      )}
      {state === "success" && outcome && tab === "trailers" && <KVTable rows={trailers} />}
      {state === "success" && outcome && tab === "headers" && <KVTable rows={headers} />}
      {isError && outcome && tab === "body" && <ErrorBody outcome={outcome} />}
      {isError && outcome && tab === "trailers" && <KVTable rows={trailers} />}
      {isError && outcome && tab === "headers" && <KVTable rows={headers} />}
    </div>
  );
}
