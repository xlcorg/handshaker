import { useEffect, useRef } from "react";
import { Lock, RefreshCw, Send, Unlock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/cn";
import type { SelectedMethod } from "./SelectedMethod";

export interface ConnectionBarProps {
  host: string;
  onHostChange: (next: string) => void;
  onHostCommit: () => void; // fires on blur / Enter — triggers describe
  tls: boolean;
  onTlsChange: (next: boolean) => void;
  sending: boolean;
  selected: SelectedMethod | null;
  onSend: () => void;
  onRefresh: () => void;
  refreshing: boolean;
  reflectNote: string | null;
  pickerSlot?: React.ReactNode;
  draft: boolean;
  connecting: boolean;
  connected: boolean;
  onConnect: () => void;
}

export function ConnectionBar({
  host,
  onHostChange,
  onHostCommit,
  tls,
  onTlsChange,
  sending,
  selected,
  onSend,
  onRefresh,
  refreshing,
  reflectNote,
  pickerSlot,
  draft,
  connecting,
  connected,
  onConnect,
}: ConnectionBarProps) {
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!draft) return;
    const t = setTimeout(() => ref.current?.focus(), 40);
    return () => clearTimeout(t);
  }, [draft]);

  const hint = connecting
    ? "negotiating…"
    : draft
      ? host.trim()
        ? "press Connect to discover methods"
        : "enter a server address"
      : connected
        ? "select a method"
        : "not connected";

  return (
    <div className="flex-none border-b border-border bg-background relative z-10">
      <div className="h-14 flex items-center gap-2 px-3.5">
        <Tooltip content={tls ? "TLS enabled — click to switch to plaintext" : "Plaintext — click to enable TLS"}>
          <Button
            variant="outline"
            size="icon"
            onClick={() => onTlsChange(!tls)}
            aria-label={tls ? "TLS enabled" : "Plaintext"}
            className="h-9 w-9 flex-none"
          >
            {tls ? <Lock className="size-3.5" /> : <Unlock className="size-3.5" />}
          </Button>
        </Tooltip>
        <div
          className={cn(
            "flex-1 min-w-0 flex items-stretch h-9 rounded-md bg-background",
            draft ? "border border-ring ring-1 ring-ring" : "border border-input focus-within:ring-1 focus-within:ring-ring",
          )}
        >
          <input
            ref={ref}
            value={host}
            onChange={(e) => onHostChange(e.target.value)}
            onBlur={onHostCommit}
            onKeyDown={(e) => {
              if (e.key !== "Enter") return;
              if (draft) {
                if (host.trim().length > 0) onConnect();
              } else {
                onHostCommit();
              }
            }}
            placeholder="host:port"
            className="w-[44%] min-w-[140px] h-full px-3 bg-transparent font-mono text-[12.5px] text-foreground placeholder:text-muted-foreground focus:outline-none rounded-l-md"
          />
          <span className="w-px self-stretch bg-border my-1.5" />
          <div className="flex-1 min-w-0 flex items-center pl-2 pr-1.5">
            {connected && pickerSlot ? (
              pickerSlot
            ) : (
              <span className="font-mono text-[11px] text-muted-foreground/70 select-none truncate">
                {hint}
              </span>
            )}
          </div>
        </div>
        {connected && (
          <Tooltip content="Refresh contract">
            <Button
              variant="ghost"
              size="icon"
              onClick={onRefresh}
              disabled={!host || refreshing}
              aria-label="Refresh contract"
              className="h-9 w-9 flex-none text-muted-foreground hover:text-foreground"
            >
              <RefreshCw className={cn("size-3.5", refreshing && "animate-spin")} />
            </Button>
          </Tooltip>
        )}
        {connecting ? (
          <Button disabled className="h-9 flex-none gap-1.5">
            <span className="spinner" /> Connecting
          </Button>
        ) : connected ? (
          <Button onClick={onSend} disabled={sending || !selected} className="h-9 flex-none gap-1.5 min-w-[88px]">
            {sending ? (
              <>
                <span className="spinner" /> Sending
              </>
            ) : (
              <>
                <Send className="size-3" /> Send
              </>
            )}
          </Button>
        ) : (
          <Button onClick={onConnect} disabled={draft && !host.trim()} className="h-9 flex-none">
            Connect
          </Button>
        )}
      </div>
      {reflectNote && (
        <div className="px-3.5 pb-1.5 -mt-1 text-[11px] text-muted-foreground font-mono truncate">{reflectNote}</div>
      )}
    </div>
  );
}
