import { ChevronDown } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";

import { EditEnvDialog } from "./EditEnvDialog";

export interface EnvPillProps {
  activeEnv: string;
  /** Called after the user saves variables in the dialog. */
  onVariablesSaved: (variables: Record<string, string>) => void;
}

export function EnvPill({ activeEnv, onVariablesSaved }: EnvPillProps) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => setOpen(true)}
        className="gap-1 font-mono"
      >
        {activeEnv}
        <ChevronDown className="w-3 h-3" aria-hidden />
      </Button>
      <EditEnvDialog
        open={open}
        envName={activeEnv}
        onOpenChange={setOpen}
        onSaved={onVariablesSaved}
      />
    </>
  );
}
