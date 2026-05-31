import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { tabLabel, type RequestTabState } from "./tabModel";

interface CloseConfirmProps {
  tab: RequestTabState | null;
  onCancel: () => void;
  onDiscard: () => void;
  onSave: () => void;
}

export function CloseConfirm({ tab, onCancel, onDiscard, onSave }: CloseConfirmProps) {
  const label = tab ? tabLabel(tab) : "";

  return (
    <Dialog
      open={tab != null}
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Unsaved changes</DialogTitle>
          <DialogDescription>
            &ldquo;{label}&rdquo; has edits that haven&apos;t been saved yet. Close it anyway?
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            variant="outline"
            className="text-destructive hover:bg-destructive/10 hover:text-destructive"
            onClick={onDiscard}
          >
            Discard
          </Button>
          <Button variant="default" onClick={onSave}>
            Save &amp; close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
