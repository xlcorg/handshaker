import { useCallback, useEffect, useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";

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
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/cn";
import { messages } from "@/lib/messages";
import { ipc } from "@/ipc/client";
import type { EnvironmentIpc } from "@/ipc/bindings";

import { ENV_COLORS, colorHex, defaultColorKeyForName, resolveColorKey } from "./colors";
import { isEnvEditorDirty, loadColor, loadVars } from "./editorDirty";
import { VariablesTable } from "./VariablesTable";

const m = messages.envs.editor;

function EnvSubjectMenu({
  envs,
  originalName,
  subjectEnv,
  onPick,
  disabled,
}: {
  envs: EnvironmentIpc[];
  originalName: string | null;
  subjectEnv: EnvironmentIpc | null;
  onPick: (name: string) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      // Window capture runs before the dialog's document listener, so Escape
      // closes this menu and leaves the editor open.
      event.stopPropagation();
      setOpen(false);
    };
    document.addEventListener("pointerdown", onPointer);
    window.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [open]);
  return (
    <div ref={rootRef} className="relative">
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="shrink-0 gap-1.5 font-normal"
        aria-label={m.switchAria}
        aria-expanded={open}
        aria-haspopup="menu"
        disabled={disabled}
        onClick={() => setOpen((value) => !value)}
      >
        {subjectEnv && (
          <span
            aria-hidden
            className="size-2 shrink-0 rounded-full"
            style={{ backgroundColor: colorHex(resolveColorKey(subjectEnv)) }}
          />
        )}
        <span className="max-w-[160px] truncate">{originalName ?? m.createTitle}</span>
        <ChevronDown className="size-3.5 opacity-60" aria-hidden />
      </Button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full z-50 mt-1 min-w-[180px] rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
        >
          {envs.map((env) => {
            const current = env.name === originalName;
            return (
              <button
                key={env.name}
                type="button"
                role="menuitem"
                disabled={current}
                className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent disabled:opacity-50"
                onClick={() => {
                  setOpen(false);
                  onPick(env.name);
                }}
              >
                <span
                  aria-hidden
                  className="size-2 shrink-0 rounded-full"
                  style={{ backgroundColor: colorHex(resolveColorKey(env)) }}
                />
                <span className="truncate">{env.name}</span>
                {current && <Check className="ml-auto size-3.5" aria-hidden />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

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
  /** Edit mode only: request deletion of this env (parent opens the confirm dialog). */
  onRequestDelete?: (name: string) => void;
  /**
   * Switch the editor subject to another persisted env. Does not change the
   * workflow's active env. Parent remounts this dialog (`key={originalName}`).
   */
  onSwitch?: (name: string) => void;
}

export function EnvEditorDialog({
  open,
  originalName,
  activeEnv,
  envs,
  onOpenChange,
  onSaved,
  onRequestDelete,
  onSwitch,
}: EnvEditorDialogProps) {
  const isCreate = originalName === null;
  const [name, setName] = useState<string>(originalName ?? "");
  // Load variables synchronously at mount so the (uncontrolled) VariablesTable seeds
  // its rows from the correct value on its first render. Both callers mount this dialog
  // fresh per open (`{editor && <EnvEditorDialog open .../>}`), so a mount-time
  // initializer is sufficient — and, running once, it also can't be clobbered by a
  // background parent refetch of `envs`.
  const [vars, setVars] = useState<Record<string, string>>(() => loadVars(originalName, envs));
  const [pickedColor, setPickedColor] = useState<string | null>(() => loadColor(originalName, envs));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [colorOpen, setColorOpen] = useState(false);
  const [pendingSwitch, setPendingSwitch] = useState<string | null>(null);
  const alive = useRef(true);
  useEffect(() => {
    return () => {
      alive.current = false;
    };
  }, []);

  // Preview resolves against the EDITED rows (not the persisted env) — honest for
  // unsaved changes and for a non-active environment. No collection ctx here.
  const resolveRow = useCallback(
    (t: string) => ipc.varsResolve(t, { collection_id: null, collection_vars: null, env_vars: vars }),
    [vars],
  );

  const trimmedName = name.trim();
  const nameEmpty = trimmedName.length === 0;
  // The name may be any non-empty string (any characters). The only guards are
  // non-empty and uniqueness (the name is the store key — a duplicate would clobber).
  const nameIsDuplicate =
    !nameEmpty &&
    trimmedName !== originalName &&
    envs.some((e) => e.name === trimmedName);
  const canSave = !nameEmpty && !nameIsDuplicate;

  const effectiveColor = pickedColor ?? defaultColorKeyForName(trimmedName);
  const switchTargets = onSwitch ? envs.filter((e) => e.name !== originalName) : [];
  const showSwitcher = switchTargets.length > 0;
  const subjectEnv =
    originalName === null ? null : (envs.find((e) => e.name === originalName) ?? null);

  function requestSwitch(next: string) {
    if (busy || !onSwitch || next === originalName) return;
    const dirty = isEnvEditorDirty({ originalName, name, vars, pickedColor }, envs);
    if (dirty) {
      setPendingSwitch(next);
      return;
    }
    onSwitch(next);
  }

  async function handleSave() {
    if (!canSave) return;
    const renamed = !isCreate && trimmedName !== originalName;
    setBusy(true);
    setError(null);
    try {
      // 1. Persist the (possibly renamed) env with its current variables.
      await ipc.envUpsert({ name: trimmedName, variables: vars, color: effectiveColor });

      // 2. Renaming the active env: switch active to the new name BEFORE
      //    deleting the old one (backend env_delete refuses to delete active).
      let becameActive = false;
      if (renamed && activeEnv === originalName) {
        await ipc.envActiveSet(trimmedName);
        becameActive = true;
      }

      // 3. Renaming: drop the old name, then restore the env's position —
      //    the upsert above appended the new name at the end of the order.
      //    If envReorder fails, the catch below shows the dialog error; retry
      //    is safe — envUpsert/envDelete are both idempotent at this point.
      if (renamed && originalName !== null) {
        await ipc.envDelete(originalName);
        await ipc.envReorder(envs.map((e) => (e.name === originalName ? trimmedName : e.name)));
      }

      // 4. Create mode: auto-activate the new env.
      if (isCreate) {
        await ipc.envActiveSet(trimmedName);
        becameActive = true;
      }

      onSaved(trimmedName, becameActive);
      // A switch during this save unmounted us. Closing now would dismiss the
      // environment the user already moved to.
      if (alive.current) onOpenChange(false);
    } catch (e) {
      const t = e as { type?: string; message?: string };
      setError(t.message ?? t.type ?? m.saveFailed);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] min-h-[70vh] w-full max-w-[min(90vw,960px)] flex-col sm:max-w-[min(90vw,960px)]">
        <DialogHeader>
          <div className={cn("flex items-center justify-between gap-2", showSwitcher && "pr-8")}>
            <DialogTitle>{isCreate ? m.createTitle : m.editTitle}</DialogTitle>
            {showSwitcher && (
              <EnvSubjectMenu
                envs={envs}
                originalName={originalName}
                subjectEnv={subjectEnv}
                onPick={requestSwitch}
                disabled={busy}
              />
            )}
          </div>
          <DialogDescription className="sr-only">
            {isCreate ? m.createDescription : m.editDescription}
          </DialogDescription>
        </DialogHeader>

        {/* Identity row: name + color (pinned) */}
        <div className="space-y-1.5">
          <div className="flex items-center gap-2">
            <Input
              id="env-name"
              aria-label={m.nameAria}
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={cn("font-mono text-sm", nameIsDuplicate && "border-destructive")}
              aria-invalid={nameIsDuplicate}
              autoFocus
              placeholder={m.namePlaceholder}
            />
            <Popover open={colorOpen} onOpenChange={setColorOpen}>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  aria-label={m.colorAria}
                  className="flex size-9 shrink-0 items-center justify-center rounded-md border border-input"
                >
                  <span
                    aria-hidden
                    className="size-5 rounded-full"
                    style={{ backgroundColor: colorHex(effectiveColor) }}
                  />
                </button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-auto p-2">
                <div className="flex max-w-[136px] flex-wrap gap-1.5">
                  {ENV_COLORS.map((c) => {
                    const selected = effectiveColor === c.key;
                    return (
                      <button
                        key={c.key}
                        type="button"
                        aria-label={c.label}
                        aria-pressed={selected}
                        onClick={() => {
                          setPickedColor(c.key);
                          setColorOpen(false);
                        }}
                        className={cn(
                          "size-6 rounded-full transition focus:outline-none",
                          selected
                            ? "ring-2 ring-foreground ring-offset-2 ring-offset-background"
                            : "hover:ring-2 hover:ring-muted-foreground hover:ring-offset-2 hover:ring-offset-background",
                        )}
                        style={{ backgroundColor: c.hex }}
                      />
                    );
                  })}
                </div>
              </PopoverContent>
            </Popover>
          </div>
          {nameIsDuplicate && (
            <p className="text-xs text-destructive mt-1">{m.nameDuplicate}</p>
          )}
        </div>

        {/* Variables (scrolls internally) */}
        <div className="min-h-0 flex-1 space-y-1.5 overflow-auto">
          <Label>{m.variables}</Label>
          <VariablesTable
            value={vars}
            onChange={setVars}
            resolveRow={resolveRow}
            resolveKey={JSON.stringify(vars)}
          />
        </div>

        {error && (
          <div className="border-l-2 border-destructive bg-destructive/5 px-3 py-1.5 text-xs text-destructive">
            {error}
          </div>
        )}

        {pendingSwitch !== null && (
          // The draft stays visible while the user decides.
          <div
            role="group"
            aria-label={m.discardTitle}
            className="flex flex-wrap items-center justify-between gap-3 border-l-2 border-destructive bg-destructive/5 px-3 py-2"
          >
            <div className="min-w-0">
              <p className="text-sm font-medium">{m.discardTitle}</p>
              <p className="text-xs text-muted-foreground">{m.discardDescription}</p>
            </div>
            <div className="flex gap-2">
              <Button type="button" variant="ghost" size="sm" onClick={() => setPendingSwitch(null)}>
                {m.cancel}
              </Button>
              <Button
                type="button"
                variant="destructive"
                size="sm"
                onClick={() => {
                  if (!onSwitch) return;
                  onSwitch(pendingSwitch);
                }}
              >
                {m.discard}
              </Button>
            </div>
          </div>
        )}

        <DialogFooter>
          {!isCreate && onRequestDelete && (
            <Button
              variant="ghost"
              onClick={() => onRequestDelete(originalName as string)}
              disabled={busy}
              className="mr-auto text-destructive hover:bg-destructive/10 hover:text-destructive"
            >
              {m.delete}
            </Button>
          )}
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
            {m.cancel}
          </Button>
          <Button onClick={handleSave} disabled={!canSave || busy}>
            {busy ? m.saving : isCreate ? m.create : m.save}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
