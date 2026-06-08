import { AlertCircle, Ban, Globe, ServerCrash, ShieldAlert, TimerOff, type LucideIcon } from "lucide-react";
import { classifyTransportError, type TransportKind } from "@/features/workflow/netDiagnostics";

/** Per-kind face: a title + illustration icon. The actionable explanation comes from
 *  classifyTransportError's hint; the raw message is shown in the footer. */
const FACE: Record<TransportKind, { title: string; Icon: LucideIcon }> = {
  refused: { title: "Service unavailable", Icon: ServerCrash },
  tls: { title: "TLS handshake failed", Icon: ShieldAlert },
  dns: { title: "Host not found", Icon: Globe },
  timeout: { title: "Request timed out", Icon: TimerOff },
  cancelled: { title: "Request cancelled", Icon: Ban },
  other: { title: "Request failed", Icon: AlertCircle },
};

/**
 * Body-filling, Postman-style face for client/transport errors (no gRPC outcome —
 * connect refused, TLS, DNS, timeout…): an illustration + a friendly title and
 * explanation, with the raw error pinned in a red footer.
 */
export function ClientErrorView({ message }: { message: string }) {
  const diag = classifyTransportError(message);
  const { title, Icon } = FACE[diag.kind];
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 overflow-auto scroll-thin p-8 text-center">
      <div className="flex size-12 items-center justify-center rounded-lg border border-border bg-card text-muted-foreground">
        <Icon className="size-5" />
      </div>
      <div className="text-sm font-medium text-foreground/85">{title}</div>
      {diag.hint ? (
        <p data-testid="diag-hint" className="max-w-[400px] text-xs leading-relaxed text-muted-foreground">
          {diag.hint}
        </p>
      ) : (
        <p className="max-w-[400px] text-xs leading-relaxed text-muted-foreground">
          The request could not be completed. Check the address, port and TLS setting, then try again.
        </p>
      )}
      {/* The raw error is the important bit — keep it front-and-centre, not in a footer. */}
      <div className="w-full max-w-[460px] rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-left">
        <p className="text-[10.5px] font-medium uppercase tracking-wide text-destructive/80">Error</p>
        <p className="mt-0.5 break-all font-mono text-xs leading-relaxed text-destructive">{message}</p>
      </div>
    </div>
  );
}
