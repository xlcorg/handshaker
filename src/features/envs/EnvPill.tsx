import { ChevronDown } from "lucide-react";
import { forwardRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { ipc } from "@/ipc/client";
import type { EnvironmentIpc } from "@/ipc/bindings";

import { ConfirmDeleteEnvDialog } from "./ConfirmDeleteEnvDialog";
import { EnvEditorDialog } from "./EnvEditorDialog";
import { EnvSwitcherMenu } from "./EnvSwitcherMenu";

export interface EnvPillProps {
  envs: EnvironmentIpc[];
  activeEnv: string | null;
  /** Called whenever envs change (after upsert/delete/rename). */
  onEnvsChanged: () => void | Promise<void>;
  /** Called whenever activeEnv changes. */
  onActiveEnvChanged: (next: string | null) => void;
}

export const EnvPill = forwardRef<HTMLButtonElement, EnvPillProps>(function EnvPill(props, ref) {
  const { envs, activeEnv, onEnvsChanged, onActiveEnvChanged } = props;
  const [editor, setEditor] = useState<{ originalName: string | null } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);

  const label = activeEnv ?? "No environment";

  return (
    <>
      <EnvSwitcherMenu
        ref={ref}
        envs={envs}
        activeEnv={activeEnv}
        trigger={
          <Button variant="ghost" size="sm" className="gap-1 font-mono">
            {label}
            <ChevronDown className="w-3 h-3" aria-hidden />
          </Button>
        }
        onActiveSet={(next) => {
          onActiveEnvChanged(next);
          void ipc.envActiveSet(next);
        }}
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
            await onEnvsChanged();
            if (becameActive) onActiveEnvChanged(savedName);
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
          await onEnvsChanged();
          if (activeChangedToNull) onActiveEnvChanged(null);
        }}
      />
    </>
  );
});
