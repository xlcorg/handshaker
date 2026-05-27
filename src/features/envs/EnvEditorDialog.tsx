import { useEffect, useRef, useState } from "react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/cn";
import { ipc } from "@/ipc/client";
import type { EnvironmentIpc } from "@/ipc/bindings";

import { VariablesTable } from "./VariablesTable";

const NAME_RE = /^[a-zA-Z_][a-zA-Z0-9_-]*$/;

export interface EnvEditorDialogProps {
  open: boolean;
  /** `null` ⇒ create mode (empty name + empty vars). String ⇒ edit mode. */
  originalName: string | null;
  /** Current active env (used to decide whether a rename needs to flip active). */
  activeEnv: string | null;
  /** Existing envs (for duplicate-name detection). */
  envs: EnvironmentIpc[];
  onOpenChange: (open: boolean) => void;
  /** Called after a successful save. Parent should refetch envs + sync activeEnv. */
  onSaved: (savedName: string, becameActive: boolean) => void;
}

export function EnvEditorDialog({
  open,
  originalName,
  activeEnv,
  envs,
  onOpenChange,
  onSaved,
}: EnvEditorDialogProps) {
  const isCreate = originalName === null;
  const [name, setName] = useState<string>(originalName ?? "");
  const [vars, setVars] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Snapshot of `envs` kept fresh each render. The reload effect reads
  // through this ref instead of depending on `envs` directly, so background
  // refetches by the parent cannot clobber the user's in-progress edits.
  const envsRef = useRef<EnvironmentIpc[]>(envs);
  envsRef.current = envs;

  // Reload state whenever the dialog opens or the target env changes.
  useEffect(() => {
    if (!open) return;
    setError(null);
    setName(originalName ?? "");
    if (originalName === null) {
      setVars({});
      return;
    }
    // Edit mode: load variables for originalName from the snapshot taken when
    // the dialog opened. We deliberately do NOT depend on `envs` to avoid
    // overwriting the user's in-progress edits if the parent refetches.
    const cur = envsRef.current.find((e) => e.name === originalName);
    const loaded: Record<string, string> = {};
    if (cur) {
      // Defensive coerce — tauri-specta emits Partial<Record<...>> for HashMap.
      for (const [k, v] of Object.entries(cur.variables)) {
        if (typeof v === "string") loaded[k] = v;
      }
    }
    setVars(loaded);
  }, [open, originalName]);

  const trimmedName = name.trim();
  const nameInvalid = trimmedName.length > 0 && !NAME_RE.test(trimmedName);
  const nameEmpty = trimmedName.length === 0;
  const nameIsDuplicate =
    !nameInvalid &&
    !nameEmpty &&
    trimmedName !== originalName &&
    envs.some((e) => e.name === trimmedName);
  const canSave = !nameInvalid && !nameEmpty && !nameIsDuplicate;

  async function handleSave() {
    if (!canSave) return;
    const renamed = !isCreate && trimmedName !== originalName;
    setBusy(true);
    setError(null);
    try {
      // 1. Persist the (possibly renamed) env with its current variables.
      await ipc.envUpsert({ name: trimmedName, variables: vars });

      // 2. Renaming the active env: switch active to the new name BEFORE
      //    deleting the old one (backend env_delete refuses to delete active).
      let becameActive = false;
      if (renamed && activeEnv === originalName) {
        await ipc.envActiveSet(trimmedName);
        becameActive = true;
      }

      // 3. Renaming: drop the old name.
      if (renamed && originalName !== null) {
        await ipc.envDelete(originalName);
      }

      // 4. Create mode: auto-activate the new env.
      if (isCreate) {
        await ipc.envActiveSet(trimmedName);
        becameActive = true;
      }

      onSaved(trimmedName, becameActive);
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
          <DialogTitle>{isCreate ? "New environment" : "Edit environment"}</DialogTitle>
          <DialogDescription>
            {isCreate
              ? "Create a new environment and define its variables."
              : "Rename or update variables."}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="env-name">Name</Label>
            <Input
              id="env-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={cn(
                "font-mono text-sm",
                (nameInvalid || nameIsDuplicate) && "border-destructive",
              )}
              aria-invalid={nameInvalid || nameIsDuplicate}
              autoFocus
              placeholder="e.g. prod"
            />
            {nameInvalid && (
              <p className="text-xs text-destructive mt-1">
                name must match ^[a-zA-Z_][a-zA-Z0-9_-]*$
              </p>
            )}
            {nameIsDuplicate && (
              <p className="text-xs text-destructive mt-1">name already exists</p>
            )}
          </div>
          <div className="space-y-1.5">
            <Label>Variables</Label>
            <VariablesTable value={vars} onChange={setVars} />
          </div>
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
          <Button onClick={handleSave} disabled={!canSave || busy}>
            {busy ? "Saving…" : isCreate ? "Create" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
