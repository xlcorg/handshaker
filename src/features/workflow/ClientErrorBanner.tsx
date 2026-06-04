import { classifyTransportError } from "./netDiagnostics";

/** Banner for client/transport errors (non-gRPC). Adds a friendly hint when the message
 *  matches a known transport failure (refused / TLS / DNS / timeout / cancelled). */
export function ClientErrorBanner({ message }: { message: string }) {
  const diag = classifyTransportError(message);
  return (
    <div className="m-3 flex-none rounded-md border border-destructive bg-destructive/10 px-3 py-2 text-xs text-destructive">
      <div className="break-all">{message}</div>
      {diag.kind !== "other" ? (
        <div data-testid="diag-hint" className="mt-1 text-[11px] text-muted-foreground">
          {diag.hint}
        </div>
      ) : null}
    </div>
  );
}
