import { useEffect, useRef } from "react";
import { toast } from "sonner";
import type { UpdatePhase } from "./useUpdateCheck";

export interface UpdateToastProps {
  phase: UpdatePhase;
  version: string;
  progress: number;
  /** Was the latest check user-initiated? Gates the "checking/up-to-date/error" toasts so
   *  the silent startup check never raises a "You're on the latest version" note. */
  manual?: boolean;
  onUpdate: () => void;
  onDismiss: () => void;
}

/** Headless Postman-style updater notification driven by useUpdateCheck.
 *  Renders nothing — it owns a single sonner toast keyed by id and updates it in
 *  place across the lifecycle. Manual checks also surface their result. */
export function UpdateToast({ phase, version, progress, manual = false, onUpdate, onDismiss }: UpdateToastProps) {
  // The id of the toast we currently own, so every phase updates the SAME note.
  const idRef = useRef<string | number | null>(null);

  useEffect(() => {
    const id = idRef.current ?? undefined;
    // sonner deletes a toast after its ACTION button is clicked unless the handler
    // calls preventDefault(); we morph the SAME toast in place, so keep it alive.
    const triggerUpdate = (e: { preventDefault: () => void }) => {
      e.preventDefault();
      onUpdate();
    };
    if (phase === "available") {
      idRef.current = toast(`A new version (${version}) is available.`, {
        id,
        duration: Infinity,
        position: "bottom-right",
        action: { label: "Update now", onClick: triggerUpdate },
        cancel: { label: "Later", onClick: onDismiss },
      });
    } else if (phase === "downloading") {
      // Explicit undefined clears the available toast's buttons (sonner merges old+new).
      idRef.current = toast.loading(`Downloading update ${version}… ${progress}%`, {
        id,
        position: "bottom-right",
        action: undefined,
        cancel: undefined,
      });
    } else if (phase === "installError") {
      idRef.current = toast.error("Update failed. Please try again.", {
        id,
        duration: Infinity,
        position: "bottom-right",
        action: { label: "Retry", onClick: triggerUpdate },
        cancel: { label: "Later", onClick: onDismiss },
      });
    } else if (manual && phase === "checking") {
      idRef.current = toast.loading("Checking for updates…", {
        id,
        position: "bottom-right",
        action: undefined,
        cancel: undefined,
      });
    } else if (manual && phase === "upToDate") {
      idRef.current = toast.success("You're on the latest version.", {
        id,
        duration: 4000,
        position: "bottom-right",
        action: undefined,
        cancel: undefined,
      });
    } else if (manual && phase === "error") {
      idRef.current = toast.error("Couldn't check for updates.", {
        id,
        duration: 4000,
        position: "bottom-right",
        action: undefined,
        cancel: undefined,
      });
    } else if (idRef.current != null) {
      // idle, or a non-manual checking/upToDate/error → no actionable toast; clear ours.
      toast.dismiss(idRef.current);
      idRef.current = null;
    }
  }, [phase, version, progress, manual, onUpdate, onDismiss]);

  return null;
}
