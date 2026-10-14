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
import type { ImportSummaryIpc } from "@/ipc/bindings";
import { messages } from "@/lib/messages";

export interface ImportSummaryDialogProps {
  open: boolean;
  summary: ImportSummaryIpc | null;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ImportSummaryDialog({
  open,
  summary,
  onConfirm,
  onCancel,
}: ImportSummaryDialogProps) {
  const copy = messages.catalog.importDialog;
  const existing = summary
    ? summary.collections_existing + summary.environments_existing
    : 0;
  return (
    <AlertDialog
      open={open}
      onOpenChange={(o) => {
        if (!o) onCancel();
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{copy.title}</AlertDialogTitle>
          <AlertDialogDescription>
            {summary
              ? copy.body(
                  summary.collections_total,
                  summary.environments_total,
                  existing,
                )
              : ""}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={onCancel}>
            {copy.cancel}
          </AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm}>
            {copy.confirm}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
