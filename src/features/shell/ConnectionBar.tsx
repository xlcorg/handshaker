import { Lock, Send, Unlock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/cn";
import { shortService, type SelectedMethod } from "./SelectedMethod";

export interface ConnectionBarProps {
  host: string;
  onHostChange: (next: string) => void;
  tls: boolean;
  onTlsChange: (next: boolean) => void;
  connected: boolean;
  connecting: boolean;
  busy: boolean;
  sending: boolean;
  selected: SelectedMethod | null;
  onConnect: () => void;
  onDisconnect: () => void;
  onSend: () => void;
  pickerSlot?: React.ReactNode;
}

export function ConnectionBar({
  host,
  onHostChange,
  tls,
  onTlsChange,
  connected,
  connecting,
  busy,
  sending,
  selected,
  onConnect,
  onDisconnect,
  onSend,
  pickerSlot,
}: ConnectionBarProps) {
  return (
    <div className="h-14 flex-none flex items-center gap-2 px-3.5 border-b border-border bg-background relative z-10">
      <Tooltip content={tls ? "TLS enabled — click to switch to plaintext" : "Plaintext — click to enable TLS"}>
        <Button
          variant="outline"
          size="icon"
          onClick={() => onTlsChange(!tls)}
          disabled={busy || connected}
          aria-label={tls ? "TLS enabled" : "Plaintext"}
          className="h-9 w-9 flex-none"
        >
          {tls ? <Lock className="size-3.5" /> : <Unlock className="size-3.5" />}
        </Button>
      </Tooltip>
      <div className="flex-1 min-w-0 flex items-stretch h-9 rounded-md border border-input bg-background focus-within:ring-1 focus-within:ring-ring">
        <Input
          value={host}
          onChange={(e) => onHostChange(e.target.value)}
          disabled={busy || connected}
          placeholder="host:port"
          className={cn(
            "w-[44%] min-w-[140px] h-full px-3 bg-transparent font-mono text-[12.5px]",
            "border-0 shadow-none focus-visible:ring-0 focus-visible:ring-offset-0 rounded-l-md rounded-r-none",
          )}
        />
        {connected && selected ? (
          <>
            <span className="w-px self-stretch bg-border my-1.5" />
            <div className="flex-1 min-w-0 flex items-center pl-2 pr-1.5">
              <span className="text-muted-foreground/60 font-mono text-xs select-none mr-0.5">/</span>
              {pickerSlot ?? (
                <span className="font-mono text-xs truncate">
                  <span className="text-muted-foreground">{shortService(selected.service)}</span>
                  <span className="text-muted-foreground/50">/</span>
                  <span className="text-foreground font-medium">{selected.method}</span>
                </span>
              )}
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center pl-2 pr-3 text-[11.5px] text-muted-foreground/70 font-mono select-none">
            {connecting ? "negotiating…" : "not connected"}
          </div>
        )}
      </div>
      {!connected && !connecting && (
        <Button onClick={onConnect} disabled={busy || !host} className="h-9 flex-none">
          Connect
        </Button>
      )}
      {connecting && (
        <Button disabled className="h-9 flex-none gap-1.5">
          <span className="spinner" /> Connecting
        </Button>
      )}
      {connected && (
        <>
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
          <Tooltip content="Disconnect">
            <Button
              variant="ghost"
              size="icon"
              onClick={onDisconnect}
              className="h-9 w-9 flex-none text-muted-foreground hover:text-foreground"
              aria-label="Disconnect"
            >
              <Unlock className="size-3.5" />
            </Button>
          </Tooltip>
        </>
      )}
    </div>
  );
}
