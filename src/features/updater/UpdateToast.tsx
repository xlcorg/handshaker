import { useEffect, useRef } from "react";
import { toast } from "sonner";
import type { UpdatePhase } from "./useUpdateCheck";

export interface UpdateToastProps {
  phase: UpdatePhase;
  version: string;
  progress: number;
  onUpdate: () => void;
  onDismiss: () => void;
}

/** Headless Postman-style updater notification driven by useUpdateCheck.
 *  Renders nothing — it owns a single sonner toast keyed by id and updates it in
 *  place across the available → downloading → installError lifecycle. */
export function UpdateToast({ phase, version, progress, onUpdate, onDismiss }: UpdateToastProps) {
  // The id of the toast we currently own, so every phase updates the SAME note
  // instead of stacking new ones.
  const idRef = useRef<string | number | null>(null);

  useEffect(() => {
    const id = idRef.current ?? undefined;
    // sonner deletes a toast after its ACTION button is clicked unless the handler
    // calls preventDefault(); we morph the SAME toast to the progress/error state in
    // place, so keep it alive.
    const triggerUpdate = (e: { preventDefault: () => void }) => {
      e.preventDefault();
      onUpdate();
    };
    if (phase === "available") {
      // No `dismissible: false`: sonner guards the cancel button with
      // `if (!dismissible) return;`, which would make "Later" inert. duration:Infinity
      // already keeps the toast from auto-expiring.
      idRef.current = toast(`A new version (${version}) is available.`, {
        id,
        duration: Infinity,
        position: "bottom-right",
        action: { label: "Update now", onClick: triggerUpdate },
        cancel: { label: "Later", onClick: onDismiss },
      });
    } else if (phase === "downloading") {
      // Explicit undefined clears the available toast's buttons: sonner merges
      // {...oldToast, ...newData}, so an absent key would leave them lingering.
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
    } else if (idRef.current != null) {
      // idle / checking / upToDate / error → no actionable update; clear our toast.
      toast.dismiss(idRef.current);
      idRef.current = null;
    }
  }, [phase, version, progress, onUpdate, onDismiss]);

  return null;
}
