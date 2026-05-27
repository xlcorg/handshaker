import { useEffect, useState } from "react";
import { ConnectPanel } from "@/features/connect/ConnectPanel";
import { CatalogList } from "@/features/connect/CatalogList";
import { InvokePanel, type SelectedMethod } from "@/features/invoke/InvokePanel";
import { ResponsePanel } from "@/features/response/ResponsePanel";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import {
  onConnectionStateChanged,
  onContractUpdated,
} from "@/ipc/events";
import { ipc } from "@/ipc/client";
import type { ServiceCatalogIpc, InvokeOutcomeIpc } from "@/ipc/bindings";

export default function App() {
  const [catalog, setCatalog] = useState<ServiceCatalogIpc | null>(null);
  const [connected, setConnected] = useState(false);
  const [version, setVersion] = useState("");
  const [selected, setSelected] = useState<SelectedMethod | null>(null);
  const [outcome, setOutcome] = useState<InvokeOutcomeIpc | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    ipc.appVersion().then(setVersion).catch(console.error);
  }, []);

  useEffect(() => {
    let unlistenA: (() => void) | undefined;
    let unlistenB: (() => void) | undefined;
    onConnectionStateChanged((e) => setConnected(e.connected)).then(
      (fn) => (unlistenA = fn),
    );
    onContractUpdated((e) => console.log("contract updated:", e.target_key)).then(
      (fn) => (unlistenB = fn),
    );
    return () => {
      unlistenA?.();
      unlistenB?.();
    };
  }, []);

  // On disconnect — clear selected + outcome.
  useEffect(() => {
    if (!connected) {
      setSelected(null);
      setOutcome(null);
    }
  }, [connected]);

  return (
    <main className="h-screen bg-background text-foreground flex flex-col overflow-hidden">
      <header className="px-6 py-3 border-b border-border flex items-center justify-between shrink-0">
        <h1 className="text-base font-semibold">Handshaker</h1>
        <span className="text-xs text-muted-foreground font-mono">v{version}</span>
      </header>
      <section
        className={`p-6 flex flex-col gap-6 shrink-0 overflow-y-auto ${
          selected ? "max-h-[40vh]" : "flex-1"
        }`}
      >
        <ConnectPanel
          connected={connected}
          onConnected={(c) => setCatalog(c)}
          onDisconnected={() => setCatalog(null)}
        />
        {catalog && (
          <CatalogList
            catalog={catalog}
            selected={selected}
            onSelect={(m) => {
              setSelected(m);
              setOutcome(null);
              setError(null);
            }}
          />
        )}
      </section>
      {selected && (
        <div className="flex-1 min-h-0 flex flex-col border-t border-border">
          <ResizablePanelGroup
            orientation="vertical"
            className="flex-1 min-h-0 w-full"
          >
            <ResizablePanel defaultSize={50} minSize={20}>
              <InvokePanel
                selected={selected}
                onOutcome={(o) => {
                  setOutcome(o);
                  setError(null);
                }}
                onError={(m) => setError(m)}
              />
            </ResizablePanel>
            <ResizableHandle withHandle />
            <ResizablePanel defaultSize={50} minSize={20}>
              {error ? (
                <div className="p-4 text-sm text-destructive font-mono break-words h-full overflow-auto">
                  {error}
                </div>
              ) : outcome ? (
                <ResponsePanel outcome={outcome} />
              ) : (
                <div className="p-4 text-sm text-muted-foreground italic h-full">
                  Press Send to invoke.
                </div>
              )}
            </ResizablePanel>
          </ResizablePanelGroup>
        </div>
      )}
    </main>
  );
}
