import { ChevronDown } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { ConfirmDeleteEnvDialog } from "@/features/envs/ConfirmDeleteEnvDialog";
import { EnvEditorDialog } from "@/features/envs/EnvEditorDialog";
import { EnvSwitcherMenu } from "@/features/envs/EnvSwitcherMenu";
import { bumpEnvRevision, useEnvRevision } from "@/features/envs/envRevision";
import { colorHex, resolveColorKey } from "@/features/envs/colors";
import { isEnvCycleHotkey, nextEnvName } from "@/features/envs/cycle";
import { envList, envReorder } from "@/ipc/client";
import type { EnvironmentIpc } from "@/ipc/bindings";

import { useActiveWorkflow, workflowStore } from "./store";

/**
 * Titlebar env switcher bound to the ACTIVE WORKFLOW.
 *
 * Env selection routes through {@link workflowStore.setWorkflowEnv} (which
 * updates the active workflow's `envName` and syncs the backend via
 * `envActiveSet`). This component never calls `ipc.envActiveSet` directly —
 * the store owns that.
 */
export function WorkflowEnvControl() {
  const wf = useActiveWorkflow();
  // A bump (e.g. applyImport merging environments) re-runs the fetch effect below
  // so imported envs surface without a remount.
  const envRevision = useEnvRevision();
  const [envs, setEnvs] = useState<EnvironmentIpc[]>([]);
  const [editor, setEditor] = useState<{ originalName: string | null } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);

  const refreshEnvs = useCallback(async () => {
    try {
      setEnvs(await envList());
    } catch {
      setEnvs([]);
    }
  }, []);

  const handleReorder = useCallback(
    async (names: string[]) => {
      // Optimistic: apply the new order locally; on IPC failure refetch so the
      // menu snaps back to the backend's order.
      setEnvs((prev) => {
        const byName = new Map(prev.map((e) => [e.name, e] as const));
        const next = names.flatMap((n) => {
          const env = byName.get(n);
          return env ? [env] : [];
        });
        return next.length === prev.length ? next : prev;
      });
      try {
        await envReorder(names);
      } catch {
        await refreshEnvs();
      }
    },
    [refreshEnvs],
  );

  useEffect(() => {
    void refreshEnvs();
  }, [refreshEnvs, envRevision]);

  const activeEnv = wf.envName;
  const label = activeEnv ?? "No environment";
  const activeEnvObj = envs.find((e) => e.name === activeEnv) ?? null;

  // Глобальный Ctrl+E / Cmd+E циклит env активного воркфлоу (исключая «No
  // environment»). Capture-фаза задаёт лишь ПОРЯДОК (мы раньше Monaco), но не
  // подавление: на macOS Monaco биндит Cmd+E на actions.findWithSelection
  // (открывает виджет поиска). Чтобы сфокусированный редактор не получил
  // клавишу, на обработанном хоткее нужен stopPropagation — иначе событие в
  // capture-фазе доходит до DOM-узла редактора и поверх цикла env всплывает
  // окно поиска (один preventDefault Monaco не останавливает).
  // Перепривязка на [envs, activeEnv] держит замыкание свежим.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat || !isEnvCycleHotkey(e)) return;
      const next = nextEnvName(envs.map((x) => x.name), activeEnv);
      if (next === null) return; // ноль env — не глотаем клавишу (Monaco обработает)
      e.preventDefault();
      e.stopPropagation();
      workflowStore.setWorkflowEnv(next);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [envs, activeEnv]);

  return (
    <>
      <EnvSwitcherMenu
        envs={envs}
        trigger={
          <button
            type="button"
            className="flex items-center gap-1 rounded px-2 py-0.5 text-xs text-muted-foreground hover:bg-accent"
          >
            {activeEnv && (
              <span
                aria-hidden
                className="size-2 shrink-0 rounded-full"
                style={{ backgroundColor: colorHex(resolveColorKey(activeEnvObj ?? { name: activeEnv, color: null })) }}
              />
            )}
            <span className="max-w-[180px] truncate text-foreground">{label}</span>
            <ChevronDown className="size-3" aria-hidden />
          </button>
        }
        onActiveSet={(next) => workflowStore.setWorkflowEnv(next)}
        onEditEnv={(name) => setEditor({ originalName: name })}
        onNewEnv={() => setEditor({ originalName: null })}
        onReorder={handleReorder}
      />
      {editor && (
        <EnvEditorDialog
          open={true}
          originalName={editor.originalName}
          activeEnv={activeEnv}
          envs={envs}
          onOpenChange={(open) => {
            if (!open) setEditor(null);
          }}
          onSaved={async (savedName, becameActive) => {
            await refreshEnvs();
            // Env contents changed — re-resolve any preview bound to the active env
            // (e.g. the collection-variables editor, which resolves via the backend).
            bumpEnvRevision();
            if (becameActive) workflowStore.setWorkflowEnv(savedName);
          }}
          onRequestDelete={(name) => {
            setEditor(null);
            setDeleteTarget(name);
          }}
        />
      )}
      <ConfirmDeleteEnvDialog
        target={deleteTarget}
        activeEnv={activeEnv}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
        onDeleted={async (_name, activeChangedToNull) => {
          await refreshEnvs();
          if (activeChangedToNull) workflowStore.setWorkflowEnv(null);
        }}
      />
    </>
  );
}
