import type { ReactNode } from "react";
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from "@/components/ui/resizable";
import { usePrefs } from "@/lib/use-prefs";

/** The request/response split of a Focus panel. Orientation and size are user prefs. */
export function FocusSplit({
  request,
  response,
}: {
  request: ReactNode;
  response: ReactNode;
}) {
  const [prefs, setPref] = usePrefs();
  // prefs.split is our own convention ("horizontal" = a horizontal divider = Top/Bottom);
  // react-resizable-panels uses the inverse ("horizontal" = side-by-side), so flip it.
  const orientation = prefs.split === "horizontal" ? "vertical" : "horizontal";
  return (
    <ResizablePanelGroup
      key={orientation}
      orientation={orientation}
      className="min-h-0 flex-1"
      defaultLayout={{
        request: prefs.bodyPanel,
        response: 100 - prefs.bodyPanel,
      }}
      onLayoutChanged={(layout: Record<string, number>) => {
        const pct = layout["request"];
        if (typeof pct === "number" && pct > 0) setPref("bodyPanel", pct);
      }}
    >
      <ResizablePanel id="request" minSize="20%">
        {request}
      </ResizablePanel>
      <ResizableHandle withHandle />
      <ResizablePanel id="response" minSize="20%">
        {response}
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}
