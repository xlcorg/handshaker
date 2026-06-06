import { ChevronDown } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { ConfirmDeleteEnvDialog } from "@/features/envs/ConfirmDeleteEnvDialog";
import { EnvEditorDialog } from "@/features/envs/EnvEditorDialog";
import { EnvSwitcherMenu } from "@/features/envs/EnvSwitcherMenu";
import { envList } from "@/ipc/client";
import type { EnvironmentIpc } from "@/ipc/bindings";

import { useActiveWorkflow, workflowStore } from "./store";

/**
 * Titlebar env switcher bound to the ACTIVE WORKFLOW.
 *
 * Mirrors {@link EnvPill}, except env selection routes through
 * {@link workflowStore.setWorkflowEnv} (which updates the active workflow's
 * `envName` and syncs the backend via `envActiveSet`). This component never
 * calls `ipc.envActiveSet` directly — the store owns that.
 */
export function WorkflowEnvControl() {
  const wf = useActiveWorkflow();
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

  useEffect(() => {
    void refreshEnvs();
  }, [refreshEnvs]);

  const activeEnv = wf.envName;
  const label = activeEnv ?? "No environment";

  return (
    <>
      <EnvSwitcherMenu
        envs={envs}
        activeEnv={activeEnv}
        trigger={
          <button
            type="button"
            className="flex items-center gap-1 rounded px-2 py-0.5 text-xs text-muted-foreground hover:bg-accent"
          >
            <span className="max-w-[180px] truncate text-foreground">{label}</span>
            <ChevronDown className="size-3" aria-hidden />
          </button>
        }
        onActiveSet={(next) => workflowStore.setWorkflowEnv(next)}
        onEditEnv={(name) => setEditor({ originalName: name })}
        onDeleteEnv={(name) => setDeleteTarget(name)}
        onNewEnv={() => setEditor({ originalName: null })}
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
            if (becameActive) workflowStore.setWorkflowEnv(savedName);
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
