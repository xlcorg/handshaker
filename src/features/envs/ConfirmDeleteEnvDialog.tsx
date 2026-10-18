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
import { messages } from "@/lib/messages";

import type { ConfirmView } from "./useEnvEditor";

const m = messages.envs.editor;

export interface ConfirmDeleteEnvDialogProps {
  readonly view: ConfirmView | null;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
}

export function ConfirmDeleteEnvDialog({
  view,
  onConfirm,
  onCancel,
}: ConfirmDeleteEnvDialogProps) {
  const deleting = view?.phase === "deleting";
  return (
    <AlertDialog
      open={view !== null}
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
    >
      <AlertDialogContent
        onCloseAutoFocus={(e) => {
          if (document.activeElement !== document.body) e.preventDefault();
        }}
      >
        <AlertDialogHeader>
          <AlertDialogTitle>
            {m.confirmDeleteTitle(view?.name ?? "")}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {m.confirmDeleteBody(view?.variables ?? 0)}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {view?.error && (
          <p
            role="alert"
            className="text-sm text-destructive"
            title={view.error.detail}
          >
            {view.error.message}
          </p>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={deleting}>{m.cancel}</AlertDialogCancel>
          <AlertDialogAction
            variant="outline"
            disabled={deleting || !view?.ready}
            onClick={(e) => {
              e.preventDefault();
              onConfirm();
            }}
            className="border-destructive/60 text-destructive hover:bg-destructive/10 hover:text-destructive"
          >
            {deleting ? m.deleting : m.confirmDeleteAction}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
