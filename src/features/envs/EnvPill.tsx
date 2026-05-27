import { ChevronDown } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";

import { EditEnvDialog } from "./EditEnvDialog";

export interface EnvPillProps {
  activeEnv: string | null;
  /** Called after the user saves variables in the dialog. */
  onVariablesSaved: (variables: Record<string, string>) => void;
}

export function EnvPill({ activeEnv, onVariablesSaved }: EnvPillProps) {
  const [open, setOpen] = useState(false);
  const label = activeEnv ?? "No environment";
  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => {
          // In this transitional state, opening the editor only makes sense for
          // a concrete env. No-op when active is null; the dropdown menu (Task
          // 10) will provide both "switch" and "open editor for a row" paths.
          if (activeEnv !== null) setOpen(true);
        }}
        className="gap-1 font-mono"
        disabled={activeEnv === null}
      >
        {label}
        <ChevronDown className="w-3 h-3" aria-hidden />
      </Button>
      {activeEnv !== null && (
        <EditEnvDialog
          open={open}
          envName={activeEnv}
          onOpenChange={setOpen}
          onSaved={onVariablesSaved}
        />
      )}
    </>
  );
}
