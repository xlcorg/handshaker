import { useEffect, useState } from "react";

import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ipc } from "@/ipc/client";

import { VariablesTable } from "./VariablesTable";

export interface EditEnvDialogProps {
  open: boolean;
  envName: string;
  onOpenChange: (open: boolean) => void;
  /** Called after a successful save with the updated variables. */
  onSaved: (variables: Record<string, string>) => void;
}

export function EditEnvDialog({ open, envName, onOpenChange, onSaved }: EditEnvDialogProps) {
  const [vars, setVars] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setError(null);
    // Load current variables for the env.
    (async () => {
      try {
        const envs = await ipc.envList();
        const cur = envs.find((e) => e.name === envName);
        // Coerce Partial<Record<string,string>> from bindings to Record<string,string>
        // by stripping any undefined values (defensive — backend never emits undefined).
        const loaded: Record<string, string> = {};
        if (cur) {
          for (const [k, v] of Object.entries(cur.variables)) {
            if (typeof v === "string") loaded[k] = v;
          }
        }
        setVars(loaded);
      } catch (e) {
        const t = e as { type?: string; message?: string };
        setError(t.message ?? t.type ?? "failed to load env");
      }
    })();
  }, [open, envName]);

  async function handleSave() {
    setBusy(true);
    setError(null);
    try {
      await ipc.envUpsert({ name: envName, variables: vars });
      onSaved(vars);
      onOpenChange(false);
    } catch (e) {
      const t = e as { type?: string; message?: string };
      setError(t.message ?? t.type ?? "save failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Edit variables — {envName}</DialogTitle>
        </DialogHeader>
        <div className="py-2">
          <VariablesTable value={vars} onChange={setVars} />
        </div>
        {error && (
          <div className="border-l-2 border-destructive bg-destructive/5 px-3 py-1.5 text-xs text-destructive">
            {error}
          </div>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={busy}>
            {busy ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
