import { useEffect, useState } from "react";
import { ipc } from "@/ipc/client";
import { SettingsGroup } from "./SettingsDialog";

export function AboutPane() {
  const [version, setVersion] = useState("");
  useEffect(() => {
    ipc.appVersion().then(setVersion).catch(console.error);
  }, []);
  return (
    <SettingsGroup title="Handshaker">
      <p className="text-xs text-muted-foreground leading-relaxed -mt-1">
        A gRPC client for the rest of us. No accounts, no telemetry, no nonsense.
      </p>
      <div className="grid gap-1.5 font-mono text-[11.5px] text-muted-foreground mt-1">
        <div>
          version <span className="text-foreground">{version || "0.0.0"}</span>
        </div>
        <div>
          runtime <span className="text-foreground">tauri 2 · react 18</span>
        </div>
        <div>
          license <span className="text-foreground">see LICENSE</span>
        </div>
      </div>
    </SettingsGroup>
  );
}
