import { useEffect, useState } from "react";
import { ipc } from "@/ipc/client";

/** Faint app-version label pinned to the bottom-right corner.
 *
 *  Starts from the build-time version baked in by Vite (so it's visible in a plain
 *  browser `pnpm dev` too), then overrides with the authoritative Cargo.toml value via
 *  `ipc.appVersion()` once running inside Tauri. Renders nothing until a version is known. */
export function AppVersionBadge() {
  const [version, setVersion] = useState<string>(import.meta.env.VITE_APP_VERSION ?? "");

  useEffect(() => {
    ipc.appVersion().then(setVersion).catch(() => {});
  }, []);

  if (!version) return null;
  return (
    <div className="pointer-events-none fixed bottom-1 right-2 z-10 select-none font-mono text-[10px] leading-none text-muted-foreground/40">
      v{version}
    </div>
  );
}
