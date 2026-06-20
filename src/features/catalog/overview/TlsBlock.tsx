import { AlertCircle } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/cn";

export interface TlsState {
  enabled: boolean;
  skipVerify: boolean;
}

interface TlsBlockProps {
  enabled: boolean;
  skipVerify: boolean;
  onChange: (next: TlsState) => void;
}

export function TlsBlock({ enabled, skipVerify, onChange }: TlsBlockProps) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <Switch
          checked={enabled}
          onCheckedChange={(checked) => onChange({ enabled: checked, skipVerify })}
        />
        <div className="min-w-0">
          <div className="text-[12.5px] text-foreground/90">Use TLS by default</div>
          <div className="text-[11px] text-muted-foreground/70">
            New requests in this collection start with TLS enabled.
          </div>
        </div>
      </div>

      <div
        className={cn(
          "flex items-center gap-3 pl-1 transition-opacity",
          !enabled && "opacity-40 pointer-events-none select-none",
        )}
      >
        <Switch
          checked={enabled && skipVerify}
          onCheckedChange={(checked) => onChange({ enabled, skipVerify: checked })}
          disabled={!enabled}
        />
        <div className="min-w-0">
          <div className="text-[12.5px] text-foreground/90 flex items-center gap-1.5">
            Skip certificate verification
          </div>
          <div className="text-[11px] text-muted-foreground/70">
            {enabled
              ? "Accept self-signed or mismatched certs."
              : "Enable TLS to configure verification."}
          </div>
        </div>
      </div>

      {enabled && skipVerify && (
        <div className="flex items-start gap-2 rounded-md border border-warn/30 bg-warn/[0.06] px-3 py-2 ml-1">
          <span className="text-warn mt-0.5 flex-none">
            <AlertCircle size={13} />
          </span>
          <p className="text-[11px] text-warn/90 leading-relaxed">
            Connections won't validate server certificates. Use only for local or trusted endpoints.
          </p>
        </div>
      )}
    </div>
  );
}
