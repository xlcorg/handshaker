import { StatusBar } from "./StatusBar";
import { BodyView } from "./BodyView";
import { TrailersView } from "./TrailersView";
import type { InvokeOutcomeIpc } from "@/ipc/bindings";

export interface ResponsePanelProps {
  outcome: InvokeOutcomeIpc;
}

export function ResponsePanel({ outcome }: ResponsePanelProps) {
  return (
    <div className="flex flex-col h-full">
      <StatusBar outcome={outcome} />
      <div className="flex-1 min-h-0">
        {outcome.response_json !== null && outcome.response_json !== undefined ? (
          <BodyView json={outcome.response_json} />
        ) : (
          <div className="text-sm text-muted-foreground p-4 italic">
            No response body (status code {outcome.status_code}).
          </div>
        )}
      </div>
      <TrailersView trailers={outcome.trailing_metadata} />
    </div>
  );
}
