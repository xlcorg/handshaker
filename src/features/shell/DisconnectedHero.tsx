interface DisconnectedHeroProps {
  connecting: boolean;
  host: string;
}

export function DisconnectedHero({ connecting, host }: DisconnectedHeroProps) {
  if (connecting) {
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
        <LogoLarge />
      </div>
      <div className="text-foreground text-lg font-semibold tracking-tight mb-1.5">Start a connection</div>
      <div className="text-muted-foreground text-sm max-w-[400px] leading-relaxed mb-5">
        Enter a host above and we'll discover services via gRPC reflection. No proto files required for most servers.
      </div>
      <div className="flex items-center gap-2 text-[11.5px] font-mono text-muted-foreground">
        <span className="px-2 py-1 border border-border rounded-md bg-card">localhost:5002</span>
        <span className="px-2 py-1 border border-border rounded-md bg-card">api.staging…:443</span>
        <span className="px-2 py-1 border border-border rounded-md bg-card">+ from .proto</span>
      </div>
    </div>
  );
}

function LogoLarge() {
  return (
    <svg
      width={26}
      height={26}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M4 9 L9 4 L13 8" />
      <path d="M20 15 L15 20 L11 16" />
      <path d="M8 12 L12 8 L16 12 L12 16 Z" />
    </svg>
  );
}
