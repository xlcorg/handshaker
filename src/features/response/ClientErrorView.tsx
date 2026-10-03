import {
  AlertCircle,
  ArrowLeftRight,
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
import { messages } from "@/lib/messages";

const TITLE = messages.response.clientError.title;

/** Per-kind face: a title + illustration icon. */
const FACE: Record<FaultKind, { title: string; Icon: LucideIcon }> = {
  refused: { title: TITLE.refused, Icon: ServerCrash },
  tls: { title: TITLE.tls, Icon: ShieldAlert },
  dns: { title: TITLE.dns, Icon: Globe },
  timeout: { title: TITLE.timeout, Icon: TimerOff },
  cancelled: { title: TITLE.cancelled, Icon: Ban },
  encode: { title: TITLE.encode, Icon: FileWarning },
  decode: { title: TITLE.decode, Icon: FileWarning },
  auth: { title: TITLE.auth, Icon: KeyRound },
  kind_mismatch: { title: TITLE.kind_mismatch, Icon: ArrowLeftRight },
  other: { title: TITLE.other, Icon: AlertCircle },
};

/**
 * Body-filling, Postman-style face for client/transport failures (no gRPC outcome): an
 * illustration + a friendly title and explanation, with the raw error pinned below.
 * The kind is decided in the backend (`IpcError`) — no string parsing here.
 */
export function ClientErrorView({ fault }: { fault: ClientFault }) {
  const { title, Icon } = FACE[fault.kind];
  const hint = faultHint(fault);
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
          {messages.response.clientError.fallbackHint}
        </p>
      )}
      <div className="w-full max-w-[460px] rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-left">
        <p className="text-[10px] font-medium uppercase tracking-wide text-destructive/80">
          {messages.response.clientError.errorLabel}
        </p>
        <p className="mt-0.5 break-all font-mono text-xs leading-relaxed text-destructive">{fault.message}</p>
      </div>
    </div>
  );
}
