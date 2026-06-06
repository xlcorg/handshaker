import { Plus, Settings } from "lucide-react";
import { forwardRef } from "react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { EnvironmentIpc } from "@/ipc/bindings";

export interface EnvSwitcherMenuProps {
  envs: EnvironmentIpc[];
  /** Inner content of the DropdownMenuTrigger — typically the env-pill button. */
  trigger: React.ReactNode;
  onActiveSet: (name: string | null) => void;
  /** Open the env settings/edit dialog (which also offers delete). */
  onEditEnv: (name: string) => void;
  onNewEnv: () => void;
}

/** Postman-style env switcher matching {@link WorkflowSelector}'s menu: small
 * uppercase header, plain rows (active env shown in the trigger, not marked here),
 * "No environment" in the same top group. Each real env row reveals a gear on
 * hover that opens the edit dialog (where the env can also be deleted). */
export const EnvSwitcherMenu = forwardRef<HTMLButtonElement, EnvSwitcherMenuProps>(
  function EnvSwitcherMenu(props, triggerRef) {
    const { envs, trigger, onActiveSet, onEditEnv, onNewEnv } = props;
    const sorted = [...envs].sort((a, b) => a.name.localeCompare(b.name));

    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild ref={triggerRef}>
          {trigger}
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="min-w-[220px]">
          <DropdownMenuLabel className="text-[10px] uppercase tracking-wide text-muted-foreground">
            Environments
          </DropdownMenuLabel>
          <DropdownMenuItem onSelect={() => onActiveSet(null)} className="text-muted-foreground">
            No environment
          </DropdownMenuItem>
          {sorted.map((env) => (
            <div key={env.name} className="group flex items-center">
              <DropdownMenuItem className="flex-1" onSelect={() => onActiveSet(env.name)}>
                {env.name}
              </DropdownMenuItem>
              <DropdownMenuItem
                aria-label={`Settings for ${env.name}`}
                onSelect={() => onEditEnv(env.name)}
                className="mr-1 h-6 w-6 justify-center p-0 opacity-0 group-hover:opacity-100 focus:opacity-100"
              >
                <Settings className="h-3.5 w-3.5" />
              </DropdownMenuItem>
            </div>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={onNewEnv}>
            <Plus className="size-3" /> New env…
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    );
  },
);
