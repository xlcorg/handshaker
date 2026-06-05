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

export interface DiscardDraftDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Proceed and lose the unsaved draft. */
  onDiscard: () => void;
  /** Open the Save dialog first, then proceed. */
  onSaveFirst: () => void;
}

/** Confirm before replacing a dirty unbound draft (spec §6 «заменить/сохранить?»). */
export function DiscardDraftDialog({ open, onOpenChange, onDiscard, onSaveFirst }: DiscardDraftDialogProps) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Discard unsaved request?</AlertDialogTitle>
          <AlertDialogDescription>
            The current request has unsaved changes. Save it first, or discard it to open the
            other request.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => {
              onSaveFirst();
              onOpenChange(false);
            }}
          >
            Save…
          </AlertDialogAction>
          <AlertDialogAction
            onClick={() => {
              onDiscard();
              onOpenChange(false);
            }}
            className={buttonVariants({ variant: "destructive" })}
          >
            Discard
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
