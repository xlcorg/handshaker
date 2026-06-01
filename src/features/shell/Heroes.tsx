import { Plus, Unplug } from "lucide-react";
import { Kbd } from "@/components/ui/kbd";

export function NewRequestHero() {
  return (
    <div className="flex-1 flex flex-col items-center justify-center p-10 relative z-10 text-center">
      <div className="h-14 w-14 rounded-xl border border-border bg-card flex items-center justify-center mb-5 text-foreground/85">
        <Plus size={24} />
      </div>
      <div className="text-foreground text-lg font-semibold tracking-tight mb-1.5">New request</div>
      <div className="text-muted-foreground text-sm max-w-[400px] leading-relaxed mb-5">
        Type a server address in the bar above and hit{" "}
        <span className="text-foreground/85 font-medium">Connect</span>. Handshaker runs reflection and lists
        every method — no dialog, no setup.
      </div>
      <div className="flex items-center gap-2 text-[11px] text-muted-foreground/70 font-mono">
        <span>↑ address bar</span>
        <span>·</span>
        <span className="flex items-center gap-1">
          <Kbd>↵</Kbd> to connect
        </span>
      </div>
    </div>
  );
}

export function DisconnectedHero({ scenario, host }: { scenario: string; host: string }) {
  if (scenario === "connecting") {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-10 relative z-10">
        <div className="h-11 w-11 rounded-lg border border-border bg-card flex items-center justify-center mb-3.5 text-foreground/70">
          <span className="spinner" style={{ width: 18, height: 18 }} />
        </div>
        <div className="text-foreground text-sm font-medium mb-1">Negotiating TLS…</div>
        <div className="text-muted-foreground text-xs font-mono">{host}</div>
      </div>
    );
  }
  return (
    <div className="flex-1 flex flex-col items-center justify-center p-10 relative z-10 text-center">
      <div className="h-14 w-14 rounded-xl border border-border bg-card flex items-center justify-center mb-5 text-foreground/85">
        <Unplug size={26} />
      </div>
      <div className="text-foreground text-lg font-semibold tracking-tight mb-1.5">Disconnected</div>
      <div className="text-muted-foreground text-sm max-w-[400px] leading-relaxed mb-5">
        Reconnect to resume, or pick any method from your collections in the sidebar — Handshaker connects to
        its server automatically.
      </div>
      <div className="flex items-center gap-2 text-[11.5px] font-mono text-muted-foreground">
        {host.trim() && <span className="px-2 py-1 border border-border rounded-md bg-card">{host}</span>}
        <span className="px-2 py-1 border border-border rounded-md bg-card">+ Add server</span>
      </div>
    </div>
  );
}
