import { ChevronDown } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import type { EnvironmentIpc } from "@/ipc/bindings";

import { EnvEditorDialog } from "./EnvEditorDialog";

export interface EnvPillProps {
  envs: EnvironmentIpc[];
  activeEnv: string | null;
  onSaved: (savedName: string, becameActive: boolean) => void;
}

export function EnvPill({ envs, activeEnv, onSaved }: EnvPillProps) {
  const [open, setOpen] = useState(false);
  const label = activeEnv ?? "No environment";
  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => {
          if (activeEnv !== null) setOpen(true);
        }}
        className="gap-1 font-mono"
        disabled={activeEnv === null}
      >
        {label}
        <ChevronDown className="w-3 h-3" aria-hidden />
      </Button>
      <EnvEditorDialog
        open={open}
        originalName={activeEnv}
        activeEnv={activeEnv}
        envs={envs}
        onOpenChange={setOpen}
        onSaved={onSaved}
      />
    </>
  );
}
