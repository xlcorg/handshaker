import { useState } from "react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { StatusBar } from "./StatusBar";
import { BodyView } from "./BodyView";
import { TrailersView } from "./TrailersView";
import type { InvokeOutcomeIpc } from "@/ipc/bindings";

export interface ResponsePanelProps {
  outcome: InvokeOutcomeIpc;
}

/**
 * Postman-style response panel:
 *
 * ┌──────────────────────────────────────────────────────────┐
 * │ Body  Trailers (n)              ● CODE · ms · size       │  ← tab strip + status
 * ├──────────────────────────────────────────────────────────┤
 * │ ⚠ status_message (only when status_code != 0)            │  ← inline error strip
 * ├──────────────────────────────────────────────────────────┤
 * │ active tab content                                       │
 * └──────────────────────────────────────────────────────────┘
 *
 * Tab state is local and persists across new outcomes for the same selected
 * method — when the method changes upstream, `outcome` becomes null and
 * ResponsePanel unmounts, resetting the state.
 */
type TabKey = "body" | "trailers";

export function ResponsePanel({ outcome }: ResponsePanelProps) {
  const [tab, setTab] = useState<TabKey>("body");
  const trailerCount = Object.keys(outcome.trailing_metadata ?? {}).length;
  const isError = outcome.status_code !== 0;

  return (
    <Tabs
      value={tab}
      onValueChange={(v) => setTab(v as TabKey)}
      className="flex flex-col h-full"
    >
      <div className="flex items-center justify-between border-b border-border px-3">
        <TabsList className="bg-transparent p-0 h-9">
          <TabsTrigger value="body" className="text-xs">
            Body
          </TabsTrigger>
          <TabsTrigger value="trailers" className="text-xs">
            Trailers ({trailerCount})
          </TabsTrigger>
        </TabsList>
        <StatusBar outcome={outcome} />
      </div>
      {isError && outcome.status_message && (
        <div className="border-l-2 border-destructive bg-destructive/5 px-3 py-1.5 text-xs text-destructive">
          {outcome.status_message}
        </div>
      )}
      <TabsContent value="body" className="flex-1 min-h-0 m-0">
        {outcome.response_json !== null && outcome.response_json !== undefined ? (
          <BodyView json={outcome.response_json} />
        ) : (
          <div className="text-sm text-muted-foreground p-4 italic">
            No response body (status code {outcome.status_code}).
          </div>
        )}
      </TabsContent>
      <TabsContent value="trailers" className="flex-1 min-h-0 m-0 overflow-auto">
        <TrailersView trailers={outcome.trailing_metadata} />
      </TabsContent>
    </Tabs>
  );
}
