import { useEffect, useState } from "react";
import { ConnectPanel } from "@/features/connect/ConnectPanel";
import { CatalogList } from "@/features/connect/CatalogList";
import {
  onConnectionStateChanged,
  onContractUpdated,
} from "@/ipc/events";
import { ipc } from "@/ipc/client";
import type { ServiceCatalogIpc } from "@/ipc/bindings";

export default function App() {
  const [catalog, setCatalog] = useState<ServiceCatalogIpc | null>(null);
  const [connected, setConnected] = useState(false);
  const [version, setVersion] = useState("");

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

  return (
    <main className="min-h-screen bg-background text-foreground">
      <header className="px-6 py-3 border-b border-border flex items-center justify-between">
        <h1 className="text-base font-semibold">Handshaker</h1>
        <span className="text-xs text-muted-foreground font-mono">
          v{version}
        </span>
      </header>
      <section className="p-6 flex flex-col gap-6">
        <ConnectPanel
          connected={connected}
          onConnected={(c) => setCatalog(c)}
          onDisconnected={() => setCatalog(null)}
        />
        {catalog && <CatalogList catalog={catalog} />}
      </section>
    </main>
  );
}
