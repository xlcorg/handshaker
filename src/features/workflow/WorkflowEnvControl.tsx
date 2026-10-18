import { ChevronDown } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import { EnvEditorDialog } from "@/features/envs/EnvEditorDialog";
import { EnvSwitcherMenu } from "@/features/envs/EnvSwitcherMenu";
import { bumpEnvRevision, useEnvRevision } from "@/features/envs/envRevision";
import { paintMarker } from "@/features/envs/colors";
import { envCycleChords, nextEnvName } from "@/features/envs/cycle";
import { envEditChords } from "@/features/envs/openEditor";
import { useChords } from "@/features/shell/hotkeys";
import { envList, envReorder } from "@/ipc/client";
import type { EnvironmentIpc } from "@/ipc/bindings";
import { messages } from "@/lib/messages";

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
  const [editor, setEditor] = useState<{ opened: string | null } | null>(null);

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

  // Ctrl/Cmd+E cycles the active workflow's env. Capture stops the key before
  // Monaco: on macOS Cmd+E is actions.findWithSelection, and preventDefault alone
  // does not keep the find widget from opening. Declining (repeat, or no env to
  // select) leaves the key alone so Monaco can handle it. Ctrl/Cmd+Shift+E opens
  // Edit environment and still swallows when the editor is already open.
  useChords([
    ...envCycleChords((event) => {
      if (event.repeat) return false;
      const next = nextEnvName(
        envs.map((x) => x.name),
        activeEnv,
      );
      if (next === null) return false;
      workflowStore.setWorkflowEnv(next);
    }),
    ...envEditChords((event) => {
      if (event.repeat) return false;
      if (editor !== null) return;
      setEditor({ opened: activeEnv });
    }),
  ]);

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
                style={{
                  backgroundColor: paintMarker(
                    activeEnvObj?.color ?? null,
                    activeEnv,
                  ).paint,
                }}
              />
            )}
            <span className="max-w-[180px] truncate text-foreground">
              {label}
            </span>
            <ChevronDown className="size-3" aria-hidden />
          </button>
        }
        onActiveSet={(next) => workflowStore.setWorkflowEnv(next)}
        onEditEnv={(name) => setEditor({ opened: name })}
        onNewEnv={() => setEditor({ opened: null })}
        onReorder={handleReorder}
      />
      {editor && (
        <EnvEditorDialog
          opened={editor.opened}
          envs={envs}
          onOptimistic={(env, previousName) => {
            setEnvs((prev) => replaceEnv(prev, previousName, env));
          }}
          onReverted={(currentName, env) => {
            setEnvs((prev) => replaceEnv(prev, currentName, env));
            toast.error(messages.envs.editor.saveFailed);
          }}
          onStored={async ({ activated }) => {
            await refreshEnvs();
            // Env contents changed — re-resolve any preview bound to the active env
            // (e.g. the collection-variables editor, which resolves via the backend).
            bumpEnvRevision();
            if (activated !== null) workflowStore.setWorkflowEnv(activated);
          }}
          onDeleted={async ({ name }) => {
            await refreshEnvs();
            bumpEnvRevision();
            if (workflowStore.activeWorkflow().envName === name)
              workflowStore.setWorkflowEnv(null);
          }}
          onClosed={() => setEditor(null)}
        />
      )}
    </>
  );
}

function replaceEnv(
  envs: readonly EnvironmentIpc[],
  name: string,
  env: EnvironmentIpc,
): EnvironmentIpc[] {
  const at = envs.findIndex((item) => item.name === name);
  if (at < 0) return [...envs, env];
  const next = envs.slice();
  next[at] = env;
  return next;
}
