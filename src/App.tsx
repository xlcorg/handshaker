import { useEffect, useRef, useState } from "react";
import { ConnectPanel } from "@/features/connect/ConnectPanel";
import { CatalogList } from "@/features/connect/CatalogList";
import { InvokePanel, type SelectedMethod } from "@/features/invoke/InvokePanel";
import { ResponsePanel } from "@/features/response/ResponsePanel";
import { EnvPill } from "@/features/envs/EnvPill";
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
import type { ServiceCatalogIpc, InvokeOutcomeIpc, EnvironmentIpc } from "@/ipc/bindings";

export default function App() {
  const [catalog, setCatalog] = useState<ServiceCatalogIpc | null>(null);
  const [connected, setConnected] = useState(false);
  const [version, setVersion] = useState("");
  const [selected, setSelected] = useState<SelectedMethod | null>(null);
  const [outcome, setOutcome] = useState<InvokeOutcomeIpc | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeEnv, setActiveEnv] = useState<string | null>(null);
  const [envs, setEnvs] = useState<EnvironmentIpc[]>([]);
  const envSwitcherTriggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    ipc.appVersion().then(setVersion).catch(console.error);
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!((e.metaKey || e.ctrlKey) && (e.key === "e" || e.key === "E"))) return;
      // Skip when the user is typing in a text field — including Monaco's
      // contenteditable host (handled by Monaco's own bindings, but we don't
      // want to fight it here either).
      const target = e.target as HTMLElement | null;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target?.isContentEditable
      ) {
        return;
      }
      e.preventDefault();
      envSwitcherTriggerRef.current?.click();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    ipc.envActiveGet().then(setActiveEnv).catch(console.error);
  }, []);

  useEffect(() => {
    ipc.envList().then(setEnvs).catch(console.error);
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
        <div className="flex items-center gap-3">
          <span className="text-xs text-muted-foreground font-mono">v{version}</span>
          <EnvPill
            ref={envSwitcherTriggerRef}
            envs={envs}
            activeEnv={activeEnv}
            onEnvsChanged={async () => setEnvs(await ipc.envList())}
            onActiveEnvChanged={setActiveEnv}
          />
        </div>
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
                activeEnv={activeEnv}
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
