import { useState } from "react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { buttonVariants } from "@/components/ui/button";
import { ipc } from "@/ipc/client";

export interface ConfirmDeleteEnvDialogProps {
  /** When `null`, the dialog is closed. Set to a name to open. */
  target: string | null;
  /** Current active env — used to decide whether to pre-switch on delete. */
  activeEnv: string | null;
  onOpenChange: (open: boolean) => void;
  /** Called on successful delete; parent should refetch the env list. */
  onDeleted: (deletedName: string, activeChangedToNull: boolean) => void;
}

export function ConfirmDeleteEnvDialog({
  target,
  activeEnv,
  onOpenChange,
  onDeleted,
}: ConfirmDeleteEnvDialogProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleDelete() {
    if (target === null) return;
    setBusy(true);
    setError(null);
    try {
      let activeChangedToNull = false;
      // 1. If deleting the active env, switch active to None first.
      if (activeEnv === target) {
        await ipc.envActiveSet(null);
        activeChangedToNull = true;
      }
      // 2. Delete the target env.
      await ipc.envDelete(target);

      onDeleted(target, activeChangedToNull);
      onOpenChange(false);
    } catch (e) {
      const t = e as { type?: string; message?: string };
      setError(t.message ?? t.type ?? "delete failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AlertDialog open={target !== null} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete env?</AlertDialogTitle>
          <AlertDialogDescription>
            Are you sure you want to delete <code className="font-mono">{target ?? ""}</code>? Its
            variables will be lost.
          </AlertDialogDescription>
        </AlertDialogHeader>
        {error && (
          <div className="border-l-2 border-destructive bg-destructive/5 px-3 py-1.5 text-xs text-destructive">
            {error}
          </div>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={handleDelete}
            disabled={busy}
            className={buttonVariants({ variant: "destructive" })}
          >
            {busy ? "Deleting…" : "Delete"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
