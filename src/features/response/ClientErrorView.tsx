import {
  AlertCircle,
  Ban,
  FileWarning,
  Globe,
  KeyRound,
  ServerCrash,
  ShieldAlert,
  TimerOff,
  type LucideIcon,
} from "lucide-react";
import { faultHint, type ClientFault, type FaultKind } from "@/features/workflow/netDiagnostics";

/** Per-kind face: a title + illustration icon. */
const FACE: Record<FaultKind, { title: string; Icon: LucideIcon }> = {
  refused: { title: "Service unavailable", Icon: ServerCrash },
  tls: { title: "TLS handshake failed", Icon: ShieldAlert },
  dns: { title: "Host not found", Icon: Globe },
  timeout: { title: "Request timed out", Icon: TimerOff },
  cancelled: { title: "Request cancelled", Icon: Ban },
  encode: { title: "Request couldn't be encoded", Icon: FileWarning },
  decode: { title: "Response couldn't be decoded", Icon: FileWarning },
  auth: { title: "Authentication failed", Icon: KeyRound },
  other: { title: "Request failed", Icon: AlertCircle },
};

/**
 * Body-filling, Postman-style face for client/transport failures (no gRPC outcome): an
 * illustration + a friendly title and explanation, with the raw error pinned below.
 * The kind is decided in the backend (`IpcError`) — no string parsing here.
 */
export function ClientErrorView({ fault }: { fault: ClientFault }) {
  const { title, Icon } = FACE[fault.kind];
  const hint = faultHint(fault.kind);
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 overflow-auto scroll-thin p-8 text-center">
      <div className="flex size-12 items-center justify-center rounded-lg border border-border bg-card text-muted-foreground">
        <Icon className="size-5" />
      </div>
      <div className="text-sm font-medium text-foreground/85">{title}</div>
      {hint ? (
        <p data-testid="diag-hint" className="max-w-[400px] text-xs leading-relaxed text-muted-foreground">
          {hint}
        </p>
      ) : (
        <p className="max-w-[400px] text-xs leading-relaxed text-muted-foreground">
          The request could not be completed. Check the address, port and TLS setting, then try again.
        </p>
      )}
      <div className="w-full max-w-[460px] rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-left">
        <p className="text-[10px] font-medium uppercase tracking-wide text-destructive/80">Error</p>
        <p className="mt-0.5 break-all font-mono text-xs leading-relaxed text-destructive">{fault.message}</p>
      </div>
    </div>
  );
}
