import { AlertCircle } from "lucide-react";
import type { InvokeOutcomeIpc } from "@/ipc/bindings";
import { messages } from "@/lib/messages";
import { StatusDetails } from "./StatusDetails";

/**
 * grpcurl-minimal gRPC error body, centered in the response area: an anchor icon and
 * the server's raw status message shown prominently, with structured `google.rpc`
 * details below when present. The status code + name, timing and size live once in the
 * panel summary (`RespMeta`); trailing metadata lives in the Trailers tab — neither is
 * repeated here. Mirrors the centered face of `ClientErrorView`.
 */
export function ErrorView({ outcome }: { outcome: InvokeOutcomeIpc }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-4 overflow-auto scroll-thin p-8 text-center">
      <AlertCircle className="size-7 flex-none text-destructive/80" />
      {outcome.status_message ? (
        <p className="max-w-[560px] break-words font-mono text-base leading-relaxed text-foreground/90">
          {outcome.status_message}
        </p>
      ) : null}
      {outcome.status_details.length > 0 ? (
        <div className="w-full max-w-[560px] text-left">
          <StatusDetails details={outcome.status_details} />
        </div>
      ) : (
        <p className="text-[11px] text-muted-foreground">{messages.response.error.noDetails}</p>
      )}
    </div>
  );
}
