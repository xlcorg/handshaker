import { Box, Upload } from "lucide-react";
import { SettingsGroup } from "./SettingsDialog";

export function ProtoPane() {
  return (
    <SettingsGroup title="Proto descriptors">
      <p className="text-xs text-muted-foreground leading-relaxed -mt-1">
        Handshaker prefers gRPC reflection. When reflection is unavailable, import .proto files or descriptor sets here. Not wired up yet.
      </p>
      <div className="flex items-center gap-3 p-3.5 rounded-md border border-dashed border-border bg-card">
        <div className="h-7 w-7 rounded-md border border-border flex items-center justify-center text-muted-foreground">
          <Upload className="size-3.5" />
        </div>
        <div className="flex-1 text-xs text-muted-foreground">Drop a .proto or .pb here, or click to choose</div>
      </div>
      <div className="flex items-center gap-3 p-3.5 rounded-md border border-border bg-card opacity-60">
        <div className="h-7 w-7 rounded-md border border-border flex items-center justify-center text-muted-foreground">
          <Box className="size-3.5" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-mono text-xs">no descriptors loaded</div>
          <div className="text-[11px] text-muted-foreground mt-0.5">Connect to a reflection-enabled server first.</div>
        </div>
      </div>
    </SettingsGroup>
  );
}
