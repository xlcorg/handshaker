import { useCallback, useEffect, useRef, useState } from "react";
import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import type { UpdatePhase } from "./UpdateBanner";

interface UpdateState {
  phase: UpdatePhase;
  version: string;
  progress: number;
}

export interface UseUpdateCheck extends UpdateState {
  install: () => Promise<void>;
  dismiss: () => void;
}

export function useUpdateCheck(): UseUpdateCheck {
  const [state, setState] = useState<UpdateState>({ phase: "checking", version: "", progress: 0 });
  // Hold the Update object returned by check() so install() can act on it.
  const updateRef = useRef<Awaited<ReturnType<typeof check>> | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const update = await check();
        if (cancelled) return;
        if (update) {
          updateRef.current = update;
          setState({ phase: "available", version: update.version, progress: 0 });
        } else {
          setState({ phase: "upToDate", version: "", progress: 0 });
        }
      } catch {
        if (!cancelled) setState({ phase: "error", version: "", progress: 0 });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const install = useCallback(async () => {
    const update = updateRef.current;
    if (!update) return;
    let total = 0;
    let downloaded = 0;
    setState((s) => ({ ...s, phase: "downloading", progress: 0 }));
    await update.downloadAndInstall((event) => {
      if (event.event === "Started") {
        total = event.data.contentLength ?? 0;
      } else if (event.event === "Progress") {
        downloaded += event.data.chunkLength;
        const pct = total > 0 ? Math.min(100, Math.round((downloaded / total) * 100)) : 0;
        setState((s) => ({ ...s, progress: pct }));
      }
    });
    await relaunch();
  }, []);

  const dismiss = useCallback(() => {
    setState({ phase: "idle", version: "", progress: 0 });
  }, []);

  return { ...state, install, dismiss };
}
