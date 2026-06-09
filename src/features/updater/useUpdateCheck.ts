import { useCallback, useEffect, useRef, useState } from "react";
import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

export type UpdatePhase =
  | "idle"
  | "checking"
  | "available"
  | "upToDate"
  | "downloading"
  | "installError"
  | "error";

interface UpdateState {
  phase: UpdatePhase;
  version: string;
  progress: number;
  /** True when the in-flight/last check was user-initiated (vs the silent mount check). */
  manual: boolean;
  /** Latched availability: stays true after dismiss() so the titlebar can show a badge. */
  hasUpdate: boolean;
}

export interface UseUpdateCheck extends UpdateState {
  install: () => Promise<void>;
  dismiss: () => void;
  recheck: () => void;
}

export function useUpdateCheck(): UseUpdateCheck {
  const [state, setState] = useState<UpdateState>({
    phase: "checking",
    version: "",
    progress: 0,
    manual: false,
    hasUpdate: false,
  });
  // Hold the Update object returned by check() so install() can act on it.
  const updateRef = useRef<Awaited<ReturnType<typeof check>> | null>(null);
  // Guards against overlapping checks/downloads (double clicks, recheck mid-download).
  const inFlight = useRef(false);
  // Avoid setState after unmount.
  const mounted = useRef(true);

  const run = useCallback(async (manual: boolean) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setState((s) => ({ ...s, phase: "checking", progress: 0, manual }));
    try {
      const update = await check();
      if (!mounted.current) return;
      if (update) {
        updateRef.current = update;
        setState((s) => ({ ...s, phase: "available", version: update.version, progress: 0, manual, hasUpdate: true }));
      } else {
        updateRef.current = null;
        setState((s) => ({ ...s, phase: "upToDate", version: "", progress: 0, manual, hasUpdate: false }));
      }
    } catch {
      // Swallow (incl. running outside Tauri) — keep the last-known availability latch.
      if (mounted.current) setState((s) => ({ ...s, phase: "error", manual }));
    } finally {
      inFlight.current = false;
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    void run(false);
    return () => {
      mounted.current = false;
    };
  }, [run]);

  const recheck = useCallback(() => {
    void run(true);
  }, [run]);

  const install = useCallback(async () => {
    const update = updateRef.current;
    if (!update) return;
    inFlight.current = true;
    let total = 0;
    let downloaded = 0;
    setState((s) => ({ ...s, phase: "downloading", progress: 0 }));
    try {
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
    } catch (err) {
      // On success relaunch() ends the process and we never get here; reaching the
      // catch means the download/install failed — surface a distinct error phase
      // (keeping the version) so the UI can show a failure + retry, not silently revert.
      setState((s) => ({ ...s, phase: "installError", progress: 0 }));
      throw err;
    } finally {
      inFlight.current = false;
    }
  }, []);

  const dismiss = useCallback(() => {
    // Hide the toast only — keep hasUpdate + version so the titlebar badge persists.
    setState((s) => ({ ...s, phase: "idle", progress: 0 }));
  }, []);

  return { ...state, install, dismiss, recheck };
}
