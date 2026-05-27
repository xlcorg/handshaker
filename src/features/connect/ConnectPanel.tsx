import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ipc } from "@/ipc/client";
import type { ServiceCatalogIpc } from "@/ipc/bindings";

export interface ConnectPanelProps {
  onConnected: (catalog: ServiceCatalogIpc) => void;
  onDisconnected: () => void;
  connected: boolean;
}

export function ConnectPanel(props: ConnectPanelProps) {
  // Defaults match the local Notex testbed (`127.0.0.1:5002`, plaintext).
  // Convenient for development; override at any time.
  const [address, setAddress] = useState("localhost:5002");
  const [tls, setTls] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleConnect() {
    setBusy(true);
    setError(null);
    try {
      const outcome = await ipc.grpcConnect({
        address,
        tls,
        skip_verify: false,
      });
      props.onConnected(outcome.catalog);
    } catch (e: unknown) {
      // e is an IpcError tagged union
      const tagged = e as { type?: string; message?: string };
      setError(
        tagged.message ?? tagged.type ?? "unknown error (see console)",
      );
      console.error("grpc_connect failed:", e);
    } finally {
      setBusy(false);
    }
  }

  async function handleDisconnect() {
    setBusy(true);
    try {
      await ipc.grpcDisconnect();
      props.onDisconnected();
    } catch (e) {
      console.error("grpc_disconnect failed:", e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-3 max-w-xl">
      <div className="flex items-center gap-2">
        <button
          type="button"
          className="px-2 py-1 rounded border border-border text-sm hover:bg-accent"
          onClick={() => setTls((v) => !v)}
          disabled={busy || props.connected}
          aria-label="Toggle TLS"
        >
          {tls ? "🔒 TLS" : "🔓 plaintext"}
        </button>
        <Input
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          placeholder="host:port (e.g. api.prod:8443)"
          disabled={busy || props.connected}
          className="font-mono"
        />
        {props.connected ? (
          <Button
            onClick={handleDisconnect}
            disabled={busy}
            variant="secondary"
          >
            Disconnect
          </Button>
        ) : (
          <Button
            onClick={handleConnect}
            disabled={busy || address.length === 0}
          >
            {busy ? "Connecting…" : "Connect"}
          </Button>
        )}
      </div>
      {error && (
        <div className="text-sm text-destructive font-mono break-words">
          {error}
        </div>
      )}
    </div>
  );
}
