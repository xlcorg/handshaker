import { useEffect } from "react";
import { toast } from "sonner";
import { ipc } from "@/ipc/client";

/** Notice text for the corrupt-file recovery, or null when nothing was set aside. */
export function recoveryMessage(files: string[]): string | null {
  if (files.length === 0) return null;
  const n = files.length;
  const noun = n === 1 ? "corrupt file" : "corrupt files";
  return `Recovered from ${n} ${noun}. The unreadable data was renamed ".corrupt" and set aside so the app could start; your other data is intact.`;
}

/** Pull the startup-recovery list from the backend (one-shot) and toast if non-empty. */
export async function notifyStartupRecovery(): Promise<void> {
  try {
    const files = await ipc.startupRecoveryTake();
    const msg = recoveryMessage(files);
    if (msg) toast.warning(msg);
  } catch {
    // Best-effort: a failed recovery check must never block startup.
  }
}

/** Mount hook: notify once about any files quarantined during startup load. */
export function useStartupRecovery(): void {
  useEffect(() => {
    void notifyStartupRecovery();
  }, []);
}
