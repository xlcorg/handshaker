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

export interface ImportSummaryDialogProps {
  open: boolean;
  summary: ImportSummaryIpc | null;
  onConfirm: () => void;
  onCancel: () => void;
}

/** Non-destructive import confirmation: shows what will be added/updated. */
export function ImportSummaryDialog({ open, summary, onConfirm, onCancel }: ImportSummaryDialogProps) {
  const existing = summary ? summary.collections_existing + summary.environments_existing : 0;
  return (
    <AlertDialog open={open} onOpenChange={(o) => { if (!o) onCancel(); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Import collections?</AlertDialogTitle>
          <AlertDialogDescription>
            {summary
              ? `${summary.collections_total} collections and ${summary.environments_total} environments will be imported.` +
                (existing > 0 ? ` ${existing} already exist and will be updated.` : "") +
                " Nothing is deleted."
              : ""}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={onCancel}>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm}>Import</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
